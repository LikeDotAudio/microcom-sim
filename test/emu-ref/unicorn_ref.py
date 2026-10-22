"""Reference run of MCOM.EXE on mcom-tui's Unicorn machine, with time frozen, for test/emu-diff.test.ts.

usage: unicorn_ref.py MCOM_TUI_DIR SPEC.json OUT_DIR

SPEC: {"seed": {dos name: host path}, "keys": "{WAIT 1}{ENTER}...", "run_for": secs,
       "trace": N, "slice": count, "com1": "none" | "sim" | "sim:<options>", "key_delay": secs}

The host loop is the one in mcomtui/__main__.py, driven by a virtual clock: every slice advances
it by 10 ms (after the tick and serial poll), INT 15h waits advance it by the time asked. The TypeScript side runs the same loop
on the same clock, so both see identical input at identical instructions.
Writes OUT_DIR/slices.bin (the same 14 registers at the end of every slice), OUT_DIR/trace.bin (uint16 x 14 per instruction: cs ip ax bx cx dx si di bp sp ds es ss flags),
screen.vram, screen.txt, serial.log, matrix.log, result.json.
"""
import datetime as _dt
import json
import os
import shutil
import struct
import sys
import tempfile

tui_dir, spec_path, out_dir = sys.argv[1:4]
sys.path.insert(0, tui_dir)
spec = json.load(open(spec_path))
os.makedirs(out_dir, exist_ok=True)

T0 = 1000.0
WALL0 = _dt.datetime(2026, 1, 2, 10, 0, 0)
FILE_TIME = (WALL0 - _dt.datetime(1970, 1, 1)).total_seconds()   # naive local; only used via utime below


class Clock:
    t = T0


class FakeTime:
    @staticmethod
    def monotonic():
        return Clock.t

    @staticmethod
    def sleep(s):
        Clock.t += s

    @staticmethod
    def strftime(fmt):
        return (WALL0 + _dt.timedelta(seconds=Clock.t - T0)).strftime(fmt)


class FakeDatetimeClass(_dt.datetime):
    @classmethod
    def now(cls, tz=None):
        return WALL0 + _dt.timedelta(seconds=Clock.t - T0)


class FakeDatetimeModule:
    datetime = FakeDatetimeClass
    timedelta = _dt.timedelta


from mcomtui import bios as bios_mod, dos as dos_mod, uart as uart_mod, matrix_sim as sim_mod  # noqa: E402
for mod in (bios_mod, dos_mod, uart_mod, sim_mod):
    if hasattr(mod, 'time'):
        mod.time = FakeTime
    if hasattr(mod, 'datetime'):
        mod.datetime = FakeDatetimeModule
_fixed = dos_mod._dos_time(_dt.datetime.timestamp(WALL0))
dos_mod._dos_time = lambda ts: _fixed

from mcomtui.__main__ import parse_keys, screen_text  # noqa: E402
from mcomtui.bios import Bios, VRAM  # noqa: E402
from mcomtui.dos import Dos, FileSystem  # noqa: E402
from mcomtui.machine import Exit, Machine  # noqa: E402
from mcomtui.matrix_sim import MatrixSim  # noqa: E402
from mcomtui.uart import Backend, TrafficLog, Uart  # noqa: E402
from unicorn import UC_HOOK_CODE  # noqa: E402

drive = tempfile.mkdtemp(prefix='mcomref-')
for name, src in spec['seed'].items():
    dst = os.path.join(drive, *name.split('\\'))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)
os.makedirs(os.path.join(drive, 'MICROCOM'), exist_ok=True)

logs = []
m = Machine(lambda s: logs.append(s))
printed = bytearray()


class Printer:
    def write(self, data):
        printed.extend(data)


fs = FileSystem(drive)
fs.cwd = 'MICROCOM'
Dos(m, fs, lambda s: logs.append(s), Printer(), lambda: None)
bios = Bios(m, lambda s: logs.append(s), Printer())
traffic = TrafficLog(os.path.join(out_dir, 'serial.log'))
open(os.path.join(out_dir, 'serial.log'), 'w').close()
traffic.f = open(os.path.join(out_dir, 'serial.log'), 'a', buffering=1)
traffic.t0 = Clock.t
com1 = spec.get('com1', 'none')
if com1.startswith('sim'):
    sim_log = os.path.join(out_dir, 'matrix.log')
    open(sim_log, 'w').close()
    be1 = MatrixSim(com1[4:], sim_log)
else:
    be1 = Backend()
uarts = [Uart(m, 0x3F8, 0x0C, be1, traffic, 'COM1'), Uart(m, 0x2F8, 0x0B, Backend(), traffic, 'COM2')]


def int14(mm):
    if mm.dx < len(uarts):
        uarts[mm.dx].bios(mm)
    else:
        mm.set(ax=0x8000)


m.int_handlers[0x14] = int14
m.load_mz(os.path.join(drive, 'MICROCOM', 'MCOM.EXE'), 'C:\\MICROCOM\\MCOM.EXE', spec.get('args', ''),
          {'COMSPEC': 'C:\\COMMAND.COM', 'PATH': 'C:\\;C:\\MICROCOM', 'PROMPT': '$p$g'})

N = spec.get('trace', 0)
trace = open(os.path.join(out_dir, 'trace.bin'), 'wb')
state = {'n': 0, 'hook': None}
REGS = ('cs', 'ip', 'ax', 'bx', 'cx', 'dx', 'si', 'di', 'bp', 'sp', 'ds', 'es', 'ss', 'flags')


def on_code(uc, addr, size, _ud):
    if state['n'] >= N:
        return
    state['n'] += 1
    trace.write(struct.pack('<14H', *(getattr(m, r) & 0xFFFF for r in REGS)))


if N:
    state['hook'] = m.uc.hook_add(UC_HOOK_CODE, on_code)

script = parse_keys(spec.get('keys', ''))
key_delay = spec.get('key_delay', 0.05)
run_for = spec.get('run_for', 1.0)
slice_n = spec.get('slice', 200000)
next_key_at = T0
slice_log = open(os.path.join(out_dir, 'slices.bin'), 'wb')
deadline = None
slices = 0
code = None
try:
    while True:
        try:
            m.run_slice(slice_n)
        finally:
            slice_log.write(struct.pack('<14H', *(getattr(m, r) & 0xFFFF for r in REGS)))
        slices += 1
        for _ in range(min(bios.tick(), 1)):
            for n in (0x08, 0x1C):
                if m.program_owns(n):
                    m.raise_irq(n)
                    break
        for u in uarts:
            u.poll()
        Clock.t += 0.01
        now = Clock.t
        if script and now >= next_key_at:
            item = script.pop(0)
            if isinstance(item, tuple):
                next_key_at = now + item[1]
            else:
                bios.push_key(item)
                next_key_at = now + key_delay
        elif not script and deadline is None and now >= next_key_at:
            deadline = now + run_for
        if deadline and now > deadline:
            break
        if N and state['hook'] is not None and state['n'] >= N:
            m.uc.hook_del(state['hook'])
            state['hook'] = None
except Exit as e:
    code = e.code
traffic.flush()
trace.close()
slice_log.close()
open(os.path.join(out_dir, 'screen.vram'), 'wb').write(m.read(VRAM, 4000))
open(os.path.join(out_dir, 'screen.txt'), 'w').write(screen_text(m) + '\n')
json.dump({'slices': slices, 'exit': code, 'cs': m.cs, 'ip': m.ip, 'traced': state['n'],
           'printed': printed.decode('latin1'), 'log': logs[-50:],
           'files': sorted(os.path.relpath(os.path.join(d, f), drive).replace('/', '\\')
                           for d, _, fs_ in os.walk(drive) for f in fs_)},
          open(os.path.join(out_dir, 'result.json'), 'w'), indent=1)
shutil.rmtree(drive)

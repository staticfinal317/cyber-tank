#!/usr/bin/env python3
import argparse
import os
import signal
import socket
import subprocess
import sys
import time


def wait_for_port(port: int, timeout: float) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=.5):
                return True
        except OSError:
            time.sleep(.25)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description='Run a command while a local server is alive')
    parser.add_argument('--server', required=True)
    parser.add_argument('--port', required=True, type=int)
    parser.add_argument('--timeout', type=float, default=30)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('a command is required after --')

    server = subprocess.Popen(args.server, shell=True, start_new_session=True)
    try:
        if not wait_for_port(args.port, args.timeout):
            raise RuntimeError(f'server did not listen on {args.port} within {args.timeout}s')
        print('Running browser command:', ' '.join(command), flush=True)
        result = subprocess.run(command, check=False)
        print(f'Browser command exited with {result.returncode}', flush=True)
        return result.returncode
    finally:
        os.killpg(server.pid, signal.SIGTERM)
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(server.pid, signal.SIGKILL)
            server.wait()


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""Write the result of a Veil model check as one HTML page.

    veil-trace.py Model.lean      build the checker of each #model_check in
                                  the file, run it, write Model.html
    veil-trace.py result.json     write result.html from a result that a
                                  checker printed or that the Veil VS Code
                                  extension exported

The page is index.html (next to this script) with the result inside it. It
needs no server and no network. index.html draws the trace with Veil's own
trace display; see build.mjs for how it is made.
"""
import argparse
import json
import subprocess
import sys
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA_TAG = '<script type="application/json" id="veil-data">'
BUILD_ONLY = 'VEIL_BUILD_ONLY '


def page_with(name, data):
    """index.html with `data` inside it."""
    template = (HERE / 'index.html').read_text(encoding='utf-8')
    if template.count(DATA_TAG) != 1:
        sys.exit('index.html has no place for a result. Build it again (see build.mjs).')
    start = template.index(DATA_TAG) + len(DATA_TAG)
    end = template.index('</script>', start)
    payload = json.dumps({'veilTraceViewer': 1, 'name': name, 'data': data}, ensure_ascii=False)
    # "<" as an escape, so that the JSON cannot end the script element.
    return template[:start] + payload.replace('<', '\\u003c') + template[end:]


def lake_root(path):
    """The directory of the Lake project that has `path`."""
    for folder in path.resolve().parents:
        if (folder / 'lakefile.toml').exists() or (folder / 'lakefile.lean').exists():
            return folder
    sys.exit(f'{path} is not in a Lake project (no lakefile.toml or lakefile.lean above it).')


def build_checkers(lean_file):
    """Build the checker of each #model_check in the file. Do not run them."""
    root = lake_root(lean_file)
    done = subprocess.run(
        ['lake', 'env', 'lean', '-Dveil.modelChecker.buildOnly=true', str(lean_file.resolve())],
        cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    binaries = [json.loads(line[len(BUILD_ONLY):])['binary']
                for line in done.stdout.splitlines() if line.startswith(BUILD_ONLY)]
    if not binaries:
        sys.stderr.write(done.stdout)
        sys.exit(f'Lean built no model checker for {lean_file} (exit code {done.returncode}).')
    return binaries


def run_checker(binary):
    """Run a compiled checker. Give the JSON that it prints on stdout."""
    # The checker stops when its stdin closes, so keep stdin open until the
    # result is here. Its progress goes to stderr, a line of JSON at a time.
    with subprocess.Popen([binary], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL) as process:
        output = process.stdout.read()
        status = process.wait()
    if status != 0:
        sys.exit(f'{binary} stopped with exit code {status}.')
    return json.loads(output)


def describe(data):
    result = data.get('run', {}).get('result', data) if isinstance(data.get('run'), dict) else data
    if result.get('result') == 'found_violation':
        violation = result.get('violation') or {}
        steps = len((result.get('trace') or {}).get('states', [])) - 1
        what = ', '.join(violation.get('violates') or [])
        return f"violation: {violation.get('kind')}" + (f' ({what})' if what else '') + f', {steps} steps'
    if result.get('result') == 'no_violation_found':
        return f"no violation ({result.get('explored_states')} states)"
    return str(result.get('result'))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('input', type=Path, help='a .lean file with #model_check, or a .json result')
    parser.add_argument('-o', '--output', type=Path, help='the HTML file to write (default: next to the input)')
    parser.add_argument('--json', action='store_true', help='for a .lean input, write the JSON of the result too')
    parser.add_argument('--open', action='store_true', help='open the page in the browser')
    args = parser.parse_args()

    source = args.input
    if not source.exists():
        sys.exit(f'{source} does not exist.')
    if source.suffix == '.lean':
        results = [run_checker(binary) for binary in build_checkers(source)]
    else:
        results = [json.loads(source.read_text(encoding='utf-8'))]
    if args.output and len(results) > 1:
        sys.exit(f'{source} has {len(results)} model checks. Do not give --output: each gets its own file.')

    for index, data in enumerate(results):
        suffix = f'-{index + 1}' if len(results) > 1 else ''
        name = source.stem + suffix
        target = args.output or source.with_name(name + '.html')
        target.write_text(page_with(name, data), encoding='utf-8')
        print(f'{target}: {describe(data)}')
        if args.json and source.suffix == '.lean':
            source.with_name(name + '.json').write_text(json.dumps(data, indent=1) + '\n', encoding='utf-8')
        if args.open:
            webbrowser.open(target.resolve().as_uri())


if __name__ == '__main__':
    main()

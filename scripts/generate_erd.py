"""Best-effort diagram index from CREATE TABLE migration statements.

The SQL migrations remain authoritative for constraints, partial indexes and
complex foreign keys. Regenerate after schema changes with this script.
"""
from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
tables = {}
edges = set()
def split_clauses(body):
    body = re.sub(r'--[^\n]*', '', body)
    clauses, start, depth, quote = [], 0, 0, False
    for index, char in enumerate(body):
        if char == "'":
            quote = not quote
        elif not quote and char == '(':
            depth += 1
        elif not quote and char == ')':
            depth -= 1
        elif not quote and depth == 0 and char == ',':
            clauses.append(body[start:index].strip())
            start = index + 1
    clauses.append(body[start:].strip())
    return clauses

for migration in sorted((root / 'packages/database/migrations').glob('*.sql')):
    sql = migration.read_text()
    for match in re.finditer(r'CREATE TABLE\s+(\w+)\s*\((.*?)\);', sql, re.S):
        table, body = match.groups()
        columns = []
        primary = set()
        foreign = set()
        for clause in split_clauses(body):
            column = re.match(r'(\w+)\s+(uuid|text|char\(\d+\)|integer|smallint|bigint|boolean|date|time|timestamptz|tstzrange|jsonb)(?=\s|$)', clause)
            if column:
                name, typ = column.groups()
                columns.append((name, typ))
                if 'PRIMARY KEY' in clause:
                    primary.add(name)
                if 'REFERENCES ' in clause:
                    foreign.add(name)
                    for target in re.findall(r'REFERENCES\s+(\w+)\s*\(', clause):
                        edges.add((target, table))
            else:
                pkey = re.search(r'PRIMARY KEY\s*\(([^)]+)\)', clause)
                if pkey:
                    primary.update(x.strip() for x in pkey.group(1).split(','))
                fkey = re.search(r'FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\w+)', clause)
                if fkey:
                    foreign.update(x.strip() for x in fkey.group(1).split(','))
                    edges.add((fkey.group(2), table))
        tables[table] = (columns, primary, foreign)

# Later migrations extend several original tables; include those fields and links.
for migration in sorted((root / 'packages/database/migrations').glob('*.sql')):
    sql = migration.read_text()
    for match in re.finditer(r'ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)\s+(uuid|text|integer|bigint|boolean|timestamptz|jsonb)\b([^;]*);', sql, re.S):
        table, name, typ, rest = match.groups()
        if table in tables and name not in {column for column, _ in tables[table][0]}:
            tables[table][0].append((name, typ))
            if 'REFERENCES ' in rest:
                tables[table][2].add(name)
                target = re.search(r'REFERENCES\s+(\w+)', rest)
                if target:
                    edges.add((target.group(1), table))
    for match in re.finditer(r'ALTER TABLE\s+(\w+)\s+ADD CONSTRAINT\s+\w+\s+FOREIGN KEY\s*\(([^)]+)\)\s+REFERENCES\s+(\w+)', sql, re.S):
        table, columns, parent = match.groups()
        if table in tables:
            tables[table][2].update(column.strip() for column in columns.split(','))
            edges.add((parent, table))

types = {'text':'string', 'integer':'int', 'smallint':'int', 'bigint':'int',
         'timestamptz':'datetime', 'jsonb':'json', 'tstzrange':'range'}
lines = ['erDiagram']
for table, (columns, primary, foreign) in sorted(tables.items()):
    lines.append(f'  {table} {{')
    for name, typ in columns:
        typ = 'string' if typ.startswith('char(') else types.get(typ, typ)
        marker = (' PK' if name in primary else ' FK' if name in foreign else '')
        lines.append(f'    {typ} {name}{marker}')
    lines.append('  }')
for parent, child in sorted(edges):
    if parent in tables and child in tables:
        lines.append(f'  {parent} ||--o{{ {child} : references')
target = root / 'docs/architecture/erd-full.mmd'
target.write_text('\n'.join(lines) + '\n')
print(f'{len(tables)} tables, {len(edges)} relations -> {target}')

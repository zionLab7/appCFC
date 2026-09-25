import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('interface local tem JavaScript válido e elementos usados pelo controlador', () => {
  const html = readFileSync(new URL('../apps/web/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'o módulo da interface deve existir');
  assert.doesNotThrow(() => new Function(`return (async () => {\n${script}\n})()`));
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  for (const match of script.matchAll(/\$\('([^']+)'\)/g)) {
    assert.ok(ids.has(match[1]), `elemento #${match[1]} não existe no HTML`);
  }
});

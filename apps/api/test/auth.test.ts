import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { OidcVerifier } from '../src/auth.js';

test('OIDC validates signature, issuer, audience and expiry', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {modulusLength:2048});
  const jwk = publicKey.export({format:'jwk'});
  const server = createServer((_req,res) => {res.setHeader('content-type','application/json'); res.end(JSON.stringify({keys:[{...jwk,kid:'test',alg:'RS256',use:'sig'}]}));});
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server');
    const issuer = 'http://localhost:8080/realms/gp-cfc-dev';
    const verifier = new OidcVerifier(issuer,'gp-cfc-api',`http://127.0.0.1:${address.port}/keys`);
    function token(overrides: Record<string,unknown> = {}) {
      const h = Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');
      const p = Buffer.from(JSON.stringify({iss:issuer,sub:'person-1',aud:'gp-cfc-api',exp:Math.floor(Date.now()/1000)+300,...overrides})).toString('base64url');
      const signature = sign('sha256',Buffer.from(`${h}.${p}`),privateKey).toString('base64url');
      return `${h}.${p}.${signature}`;
    }
    assert.deepEqual(await verifier.verify(token()),{issuer,subject:'person-1'});
    await assert.rejects(verifier.verify(token({aud:'different'})),{code:'INVALID_TOKEN'});
    await assert.rejects(verifier.verify(token({exp:1})),{code:'INVALID_TOKEN'});
    await assert.rejects(verifier.verify(token({iss:'different'})),{code:'INVALID_TOKEN'});
    const signed = token();
    const [head,payload,signature] = signed.split('.');
    await assert.rejects(verifier.verify(`${head}.${payload}.${signature[0]==='A'?'B':'A'}${signature.slice(1)}`),{code:'INVALID_TOKEN'});
  } finally {
    server.close();
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV=previousEnv;
  }
});

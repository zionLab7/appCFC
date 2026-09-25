import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStudentInput } from '../src/students.js';

const unitId='00000000-0000-4000-8000-000000000011';
test('cadastro aceita pessoa sem CPF e normaliza CPF válido',()=>{
  assert.deepEqual(parseStudentInput({unitId,fullName:'  Maria   Clara  '}),{unitId,fullName:'Maria Clara'});
  assert.deepEqual(parseStudentInput({unitId,fullName:'Pessoa Teste',documentKind:'CPF',documentNumber:'529.982.247-25'}),
    {unitId,fullName:'Pessoa Teste',documentKind:'CPF',documentNumber:'52998224725'});
  assert.deepEqual(parseStudentInput({unitId,fullName:'Pessoa Teste',phone:'(11) 00000-0000'}),
    {unitId,fullName:'Pessoa Teste',phone:'11000000000'});
});
test('cadastro recusa CPF inválido, campos adicionais e dados incompletos',()=>{
  for (const body of [
    {unitId,fullName:'Pessoa Teste',documentKind:'CPF',documentNumber:'111.111.111-11'},
    {unitId,fullName:'Pessoa Teste',documentKind:'CPF',documentNumber:'529.982.247-26'},
    {unitId,fullName:'Pessoa Teste',documentNumber:'52998224725'},
    {unitId,fullName:'Pessoa Teste',admin:true},
    {unitId,fullName:'Pessoa Teste',phone:'123'},
    {unitId,fullName:'Pessoa Teste',phone:'11; rm -rf'},
    {unitId,fullName:' '}
  ]) assert.throws(()=>parseStudentInput(body),{status:400});
});

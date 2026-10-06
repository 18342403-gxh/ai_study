#!/usr/bin/env node
import { simpleSplit } from '../src/services/rag/splitterPure.js'

let passed = 0
let failed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    failures.push(`${name}: ${err.message}`)
    console.log(`  ✗ ${name}`)
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) throw new Error(`expected ${expected}, got ${actual}`)
    },
    toBeGreaterThan(n) {
      if (!(actual > n)) throw new Error(`expected > ${n}, got ${actual}`)
    },
    toHaveProperty(key) {
      if (!actual?.[key]) throw new Error(`missing property ${key}`)
    },
  }
}

console.log('\nsimpleSplit tests:')

test('short text → single chunk', () => {
  const chunks = simpleSplit('hello world', 500, 50)
  expect(chunks.length).toBe(1)
})

test('long text → multiple chunks', () => {
  const chunks = simpleSplit('a'.repeat(1000), 400, 50)
  expect(chunks.length).toBeGreaterThan(1)
})

test('empty text → one chunk', () => {
  const chunks = simpleSplit('', 500, 50)
  expect(chunks.length).toBe(1)
})

test('chunk has required fields', () => {
  const c = simpleSplit('test', 500, 50)[0]
  expect(c).toHaveProperty('id')
  expect(c).toHaveProperty('content')
  expect(c).toHaveProperty('index')
  expect(c).toHaveProperty('metadata')
})

console.log(`\nResult: ${passed} passed, ${failed} failed\n`)
if (failed > 0) {
  failures.forEach((f) => console.log(`  - ${f}`))
  process.exit(1)
}

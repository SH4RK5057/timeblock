import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'timeblock-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

afterAll(async () => {
  await env.cleanup()
})

describe('firestore rules', () => {
  it('lets a user read and write their own data', async () => {
    const db = env.authenticatedContext('alice').firestore()
    await assertSucceeds(setDoc(doc(db, 'users/alice/blocks/b1'), { title: 'x' }))
    await assertSucceeds(getDoc(doc(db, 'users/alice/blocks/b1')))
    await assertSucceeds(setDoc(doc(db, 'users/alice/meta/settings'), { runningSessionId: null }))
  })

  it("blocks a user from another user's data", async () => {
    const db = env.authenticatedContext('bob').firestore()
    await assertFails(getDoc(doc(db, 'users/alice/blocks/b1')))
    await assertFails(setDoc(doc(db, 'users/alice/blocks/b2'), { title: 'x' }))
  })

  it('blocks unauthenticated access', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'users/alice/blocks/b1')))
    await assertFails(setDoc(doc(db, 'users/alice/blocks/b3'), { title: 'x' }))
  })

  it('denies everything outside users/{uid}', async () => {
    const db = env.authenticatedContext('alice').firestore()
    await assertFails(setDoc(doc(db, 'public/thing'), { a: 1 }))
  })
})

import { describe, expect, it } from 'vitest'
import { readShareState, writeShareState } from '../src/share/shareUrl'

const express = { owner: 'expressjs', repo: 'express' }

describe('share links', () => {
  it('writes the repo and a readable selection', () => {
    expect(writeShareState({ repo: express, branch: null, person: null })).toBe('?repo=expressjs/express')
    expect(writeShareState({ repo: express, branch: 'release/4.22.3', person: null })).toBe(
      '?repo=expressjs/express&branch=release/4.22.3',
    )
    expect(writeShareState({ repo: express, branch: null, person: 'login:ulisesgascon' })).toBe(
      '?repo=expressjs/express&by=ulisesgascon',
    )
    expect(writeShareState({ repo: express, branch: null, person: 'name:ann lee' })).toBe('?repo=expressjs/express&by=name:ann+lee')
    expect(writeShareState({ repo: null, branch: 'x', person: null })).toBe('')
  })

  it('reads back what it writes', () => {
    for (const state of [
      { repo: express, branch: null, person: null },
      { repo: express, branch: 'feat/a b&c', person: null },
      { repo: express, branch: null, person: 'login:dependabot[bot]' },
      { repo: express, branch: null, person: 'name:ann lee' },
    ]) {
      expect(readShareState(writeShareState(state))).toEqual(state)
    }
  })

  it('carries a garden battle as &vs, and reads it back', () => {
    const vite = { owner: 'vitejs', repo: 'vite' }
    expect(writeShareState({ repo: express, branch: null, person: null, vs: vite })).toBe('?repo=expressjs/express&vs=vitejs/vite')
    expect(readShareState('?repo=expressjs/express&vs=vitejs/vite')).toEqual({ repo: express, branch: null, person: null, vs: vite })
    expect(readShareState('?repo=expressjs/express&vs=not a repo')).toEqual({ repo: express, branch: null, person: null })
    // no battle without a repo to fight
    expect(writeShareState({ repo: null, branch: null, person: null, vs: vite })).toBe('')
    expect(writeShareState({ repo: express, branch: null, person: null }, '?vs=a/b')).toBe('?repo=expressjs/express')
  })

  it('keeps unrelated parameters and replaces its own', () => {
    expect(writeShareState({ repo: express, branch: null, person: null }, '?utm=x&repo=a/b&by=z')).toBe(
      '?utm=x&repo=expressjs/express',
    )
    expect(writeShareState({ repo: null, branch: null, person: null }, '?utm=x&repo=a/b')).toBe('?utm=x')
  })

  it('accepts a pasted GitHub URL as the repo, matches logins case-insensitively, and drops junk', () => {
    expect(readShareState('?repo=https://github.com/expressjs/express').repo).toEqual(express)
    expect(readShareState('?repo=expressjs/express&by=UlisesGascon').person).toBe('login:ulisesgascon')
    expect(readShareState('?repo=not a repo&branch=main')).toEqual({ repo: null, branch: null, person: null })
    expect(readShareState('')).toEqual({ repo: null, branch: null, person: null })
    // a branch wins over a person, as only one can be selected
    expect(readShareState('?repo=expressjs/express&branch=main&by=ann')).toEqual({ repo: express, branch: 'main', person: null })
  })
})

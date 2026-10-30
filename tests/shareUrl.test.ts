import { describe, expect, it } from 'vitest'
import { readShareState, readSubject, writeShareState, writeUserShare, type PersonView } from '../src/share/shareUrl'

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

describe('person share links', () => {
  it('writes the user and the view, and reads them back', () => {
    expect(writeUserShare({ login: 'octocat', view: 'lines' })).toBe('?user=octocat&view=lines')
    expect(writeUserShare({ login: 'octocat', view: null })).toBe('?user=octocat')
    for (const view of ['lines', 'constellation', 'helix', null] satisfies (PersonView | null)[]) {
      for (const login of ['octocat', 'SailmanSeeulater', 'foo--bar-']) {
        expect(readSubject(writeUserShare({ login, view }))).toEqual({ kind: 'user', login, view })
      }
    }
  })

  it('accepts @login and a GitHub profile URL as the user, keeping its case', () => {
    expect(readSubject('?user=@octocat')).toEqual({ kind: 'user', login: 'octocat', view: null })
    expect(readSubject('?user=https://github.com/octocat')).toEqual({ kind: 'user', login: 'octocat', view: null })
    expect(readSubject('?user=OctoCat&view=lines')).toEqual({ kind: 'user', login: 'OctoCat', view: 'lines' })
  })

  it('reads a view only when it names one exactly, and only with a user', () => {
    for (const bad of ['&view=LINES', '&view=skeleton', '&view=']) {
      expect(readSubject(`?user=octocat${bad}`)).toEqual({ kind: 'user', login: 'octocat', view: null })
    }
    expect(readSubject('?view=lines')).toBeNull()
    expect(readSubject('?view=')).toBeNull()
  })

  it('drops a user that is not a login', () => {
    for (const search of ['?user=octo+cat', '?user=-x', '?user=login', '?user=', '']) {
      expect(readSubject(search)).toBeNull()
    }
  })

  it('lets a repo win, and falls back to the user when the repo does not parse', () => {
    expect(readSubject('?repo=a/b&user=x&view=lines')).toEqual({
      kind: 'repo',
      share: { repo: { owner: 'a', repo: 'b' }, branch: null, person: null },
    })
    expect(readSubject('?repo=expressjs/express&branch=main')).toEqual({
      kind: 'repo',
      share: { repo: express, branch: 'main', person: null },
    })
    // a retired view: the life garden's links open life lines
    expect(readSubject('?repo=not a repo&user=octocat&view=garden')).toEqual({ kind: 'user', login: 'octocat', view: 'lines' })
    // a repo's selection means nothing to a user
    expect(readSubject('?user=x&branch=m&by=a&vs=c/d')).toEqual({ kind: 'user', login: 'x', view: null })
  })

  it('replaces the repo parameters with the user ones and keeps the rest', () => {
    expect(writeUserShare({ login: 'octocat', view: 'lines' }, '?utm_source=x&repo=a/b&branch=m&by=z&vs=c/d')).toBe(
      '?utm_source=x&user=octocat&view=lines',
    )
    expect(writeUserShare({ login: 'octocat', view: null }, '?utm_source=x&user=y&view=garden')).toBe('?utm_source=x&user=octocat')
  })

  it('drops the user and the view when a repo is written', () => {
    expect(writeShareState({ repo: express, branch: null, person: null }, '?user=x&view=lines')).toBe('?repo=expressjs/express')
    expect(writeShareState({ repo: null, branch: null, person: null }, '?utm_source=x&user=x&view=lines')).toBe('?utm_source=x')
  })
})

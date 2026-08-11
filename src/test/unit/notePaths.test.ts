import assert from 'node:assert'
import { describe, it } from 'mocha'
import {
  baseOf,
  childFolders,
  comparePageIds,
  dirOf,
  isSafeRelativeId,
  joinId,
  nearestExistingDir,
} from '../../notePaths'

describe('notePaths', () => {
  describe('dirOf / baseOf / joinId', () => {
    it('treats a bare filename as living at the top level', () => {
      assert.strictEqual(dirOf('note.md'), '')
      assert.strictEqual(baseOf('note.md'), 'note.md')
    })

    it('splits a nested id at the last separator', () => {
      assert.strictEqual(dirOf('design/api/spec.md'), 'design/api')
      assert.strictEqual(baseOf('design/api/spec.md'), 'spec.md')
    })

    it('joins without a leading separator at the top level', () => {
      assert.strictEqual(joinId('', 'note.md'), 'note.md')
      assert.strictEqual(joinId('design', 'note.md'), 'design/note.md')
    })

    it('round-trips any id', () => {
      for (const id of ['a.md', 'a/b.md', 'a/b/c.md']) {
        assert.strictEqual(joinId(dirOf(id), baseOf(id)), id)
      }
    })
  })

  describe('isSafeRelativeId', () => {
    it('accepts ordinary relative paths', () => {
      assert.strictEqual(isSafeRelativeId('note.md'), true)
      assert.strictEqual(isSafeRelativeId('design/api/spec.md'), true)
    })

    // These ids go straight back into Uri.joinPath, so anything that could
    // resolve outside the notes folder is rejected at the boundary.
    it('rejects traversal, absolute paths, and empty segments', () => {
      assert.strictEqual(isSafeRelativeId(''), false)
      assert.strictEqual(isSafeRelativeId('..'), false)
      assert.strictEqual(isSafeRelativeId('../secrets.md'), false)
      assert.strictEqual(isSafeRelativeId('design/../../secrets.md'), false)
      assert.strictEqual(isSafeRelativeId('/etc/passwd'), false)
      assert.strictEqual(isSafeRelativeId('design//spec.md'), false)
      assert.strictEqual(isSafeRelativeId('./spec.md'), false)
      assert.strictEqual(isSafeRelativeId('design\\spec.md'), false)
    })
  })

  describe('comparePageIds', () => {
    // load() sorts the flattened walk with this and insertPage() places new
    // pages with it; a fresh load must reproduce the in-memory order exactly.
    it('orders a list the same way a sorted insert would', () => {
      const ids = ['root.md', 'design/spec.md', 'alpha.md', 'design/api.md']
      const sorted = [...ids].sort(comparePageIds)

      const built: string[] = []
      for (const id of ids) {
        const idx = built.findIndex(
          existing => comparePageIds(existing, id) > 0,
        )
        built.splice(idx === -1 ? built.length : idx, 0, id)
      }
      assert.deepStrictEqual(built, sorted)
    })
  })

  describe('childFolders', () => {
    const ids = [
      'root.md',
      'design/spec.md',
      'design/api/v1.md',
      'design/api/v2.md',
      'meetings/2026-01.md',
    ]

    it('lists immediate children only', () => {
      assert.deepStrictEqual(
        childFolders(ids, '').map(f => f.name),
        ['design', 'meetings'],
      )
    })

    it('counts notes anywhere beneath a folder, not just directly inside', () => {
      const design = childFolders(ids, '').find(f => f.name === 'design')
      assert.strictEqual(design?.noteCount, 3)
      assert.strictEqual(design?.path, 'design')
    })

    it('descends into a subfolder', () => {
      assert.deepStrictEqual(childFolders(ids, 'design'), [
        { name: 'api', path: 'design/api', noteCount: 2 },
      ])
    })

    it('returns nothing for a leaf folder', () => {
      assert.deepStrictEqual(childFolders(ids, 'design/api'), [])
    })

    // 'designs/x.md' shares a prefix with 'design' but is not inside it.
    it('does not treat a prefix match as a child', () => {
      assert.deepStrictEqual(
        childFolders(['design/a.md', 'designs/b.md'], 'design').map(
          f => f.name,
        ),
        [],
      )
    })
  })

  describe('nearestExistingDir', () => {
    const ids = ['root.md', 'design/api/v1.md']

    it('keeps a folder that still holds notes', () => {
      assert.strictEqual(nearestExistingDir(ids, 'design/api'), 'design/api')
      assert.strictEqual(nearestExistingDir(ids, 'design'), 'design')
    })

    it('climbs to the nearest ancestor that does', () => {
      assert.strictEqual(
        nearestExistingDir(ids, 'design/api/old'),
        'design/api',
      )
      assert.strictEqual(nearestExistingDir(['root.md'], 'design/api'), '')
    })

    it('leaves the top level alone', () => {
      assert.strictEqual(nearestExistingDir([], ''), '')
    })
  })
})

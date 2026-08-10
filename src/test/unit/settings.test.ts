import assert from 'node:assert'
import { describe, it } from 'mocha'
import { createEditor } from '../../webview/editor'
import { setListIndent } from '../../webview/listPatterns'
import './cmTestHelper'

describe('settings', () => {
  describe('setListIndent', () => {
    it('updates LIST_INDENT_SIZE', () => {
      setListIndent(4)
      const patterns = require('../../webview/listPatterns')
      assert.strictEqual(patterns.LIST_INDENT_SIZE, 4)
      setListIndent(2)
    })

    it('updates LIST_INDENT to match size', () => {
      setListIndent(4)
      const patterns = require('../../webview/listPatterns')
      assert.strictEqual(patterns.LIST_INDENT, '    ')
      setListIndent(2)
    })

    it('handles size of 1', () => {
      setListIndent(1)
      const patterns = require('../../webview/listPatterns')
      assert.strictEqual(patterns.LIST_INDENT_SIZE, 1)
      assert.strictEqual(patterns.LIST_INDENT, ' ')
      setListIndent(2)
    })
  })

  describe('applySettings', () => {
    it('exposes applySettings on EditorHandle', () => {
      const container = document.createElement('div')
      const handle = createEditor(
        container,
        '',
        () => {},
        () => {},
      )
      assert.strictEqual(typeof handle.applySettings, 'function')
    })

    it('applies settings without error', () => {
      const container = document.createElement('div')
      const handle = createEditor(
        container,
        '',
        () => {},
        () => {},
      )
      assert.doesNotThrow(() => {
        handle.applySettings({
          fontFamily: 'monospace',
          lineHeight: 1.8,
          listIndentSize: 4,
          lineNumbers: true,
          lineWrapping: false,
          folding: true,
          syntaxMode: 'hidden',
        })
      })
    })

    it('applies inherit font without error', () => {
      const container = document.createElement('div')
      const handle = createEditor(
        container,
        '',
        () => {},
        () => {},
      )
      assert.doesNotThrow(() => {
        handle.applySettings({
          fontFamily: 'inherit',
          lineHeight: 1.6,
          listIndentSize: 2,
          lineNumbers: false,
          lineWrapping: true,
          folding: false,
          syntaxMode: 'muted',
        })
      })
    })
  })
})

import assert from 'node:assert'
import * as vscode from 'vscode'

suite('Extension', () => {
  test('should activate', async () => {
    const ext = vscode.extensions.getExtension('tbekaert.mdpad')
    assert.ok(ext, 'Extension not found')
    await ext.activate()
    assert.strictEqual(ext.isActive, true)
  })

  const expectedCommands = [
    'mdpad.openInEditor',
    'mdpad.newPage',
    'mdpad.deletePage',
    'mdpad.previousPage',
    'mdpad.nextPage',
    'mdpad.selectPage',
    'mdpad.exportPage',
    'mdpad.find',
    'mdpad.openSettings',
    'mdpad.searchPages',
    'mdpad.switchToGlobal',
    'mdpad.switchToWorkspace',
    'mdpad.switchToTeam',
    'mdpad.copyPageTo',
    'mdpad.toggleBold',
    'mdpad.toggleItalic',
    'mdpad.toggleStrikethrough',
    'mdpad.toggleCode',
    'mdpad.toggleHighlight',
    'mdpad.toggleHeading',
    'mdpad.enterReaderMode',
    'mdpad.exitReaderMode',
    'mdpad.focusNotes',
  ]

  for (const cmd of expectedCommands) {
    test(`should register ${cmd} command`, async () => {
      const commands = await vscode.commands.getCommands(true)
      assert.ok(commands.includes(cmd), `Command ${cmd} not registered`)
    })
  }
})

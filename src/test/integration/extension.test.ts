import assert from 'node:assert'
import * as vscode from 'vscode'

suite('Extension', () => {
  test('should activate', async () => {
    const ext = vscode.extensions.getExtension('smlfrysamuri.scribeaside')
    assert.ok(ext, 'Extension not found')
    await ext.activate()
    assert.strictEqual(ext.isActive, true)
  })

  const expectedCommands = [
    'scribeaside.openInEditor',
    'scribeaside.newPage',
    'scribeaside.deletePage',
    'scribeaside.previousPage',
    'scribeaside.nextPage',
    'scribeaside.selectPage',
    'scribeaside.exportPage',
    'scribeaside.find',
    'scribeaside.openSettings',
    'scribeaside.searchPages',
    'scribeaside.switchToGlobal',
    'scribeaside.switchToWorkspace',
    'scribeaside.switchToTeam',
    'scribeaside.refreshTeamNotes',
    'scribeaside.copyPageTo',
    'scribeaside.toggleBold',
    'scribeaside.toggleItalic',
    'scribeaside.toggleStrikethrough',
    'scribeaside.toggleCode',
    'scribeaside.toggleHighlight',
    'scribeaside.toggleHeading',
    'scribeaside.enterReaderMode',
    'scribeaside.exitReaderMode',
    'scribeaside.focusNotes',
  ]

  for (const cmd of expectedCommands) {
    test(`should register ${cmd} command`, async () => {
      const commands = await vscode.commands.getCommands(true)
      assert.ok(commands.includes(cmd), `Command ${cmd} not registered`)
    })
  }
})

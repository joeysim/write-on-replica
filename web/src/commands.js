// Named commands: what a shortcut, a menu item or the menu bar asks the page to do.
// Features register what they can do. Asking for a command that nothing has registered,
// or that says it cannot run just now, does nothing.

const table = new Map();

export const commands = {
  /**
   * @param name    e.g. 'alternatives', 'ghost', 'save'
   * @param run     does it
   * @param enabled whether it can be done just now
   */
  register(name, run, { enabled = () => true } = {}) {
    table.set(name, { run, enabled });
  },

  /** Whether the command exists and can run now. */
  can(name) {
    const command = table.get(name);
    return Boolean(command) && Boolean(command.enabled());
  },

  /** @returns {boolean} whether the command ran */
  run(name) {
    if (!commands.can(name)) return false;
    table.get(name).run();
    return true;
  },
};

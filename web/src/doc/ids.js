// Group ids: seven base-36 characters, as in the files the original writes ("h00a0dg").

/**
 * Whether `value` can be an id. Ids also arrive in files, which anyone may have written, and
 * they end up as attribute values in the page and as keys of plain objects. So: a few
 * lower-case letters and digits, and never a name that every object already has, which a
 * lookup like `groups[id]` would find without there being such a group.
 */
export const isId = (value) => typeof value === 'string' && /^[0-9a-z]{1,16}$/.test(value) && !(value in Object.prototype);

export function newId(random = Math.random) {
  let id = '';
  for (let i = 0; i < 7; i++) id += Math.floor(random() * 36).toString(36);
  return id;
}

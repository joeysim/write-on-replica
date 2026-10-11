// Group ids: seven base-36 characters, as in the files the original writes ("h00a0dg").

export function newId(random = Math.random) {
  let id = '';
  for (let i = 0; i < 7; i++) id += Math.floor(random() * 36).toString(36);
  return id;
}

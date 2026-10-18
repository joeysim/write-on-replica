# Changes

What each release of Write_On changed, newest first. What a version number promises is in
the README's [Versions](README.md#versions). A change waits under "Unreleased" until the
release that brings it.

## Unreleased

- The default model is now `glm-5.3`. Before, it was `glm-5.3-flash`.
- In Settings, you can pick the model from a list. The app gets the list from the AI
  service, with the same key. The list shows only the models that can answer this app.
- While the Lab shows a trim, the Markdown tab and Post to X use the piece with the trim's
  cuts made. The tab says so beside its size. Before, they ignored the trim.
- The Lab keeps a trim when you open the alternatives panel on a word, and when you close
  it. Before, the panel put the trim away. A change to the words still puts it away.
- When the AI reads only part of the piece for a trim, the app asks again. It now uses
  both answers together. Before, it used only the second answer, and a trim could cut
  much less than its level.
- If the AI still reads less than half of the sentences, the card tells you how much it
  read. The next level that you choose asks the AI again.
- The typo pass also finds slips in headings.
- "Make the cuts" ghosts the faded words. It no longer deletes them, so Ghost can bring any
  of them back. It also changes no letters: a sentence whose first words go keeps its
  lowercase start.
- The typo pass and the marking passes work more often with the real models. When an
  answer quotes nothing from the text, the Lab asks again. The typo pass also asks
  again when the AI finds no slips. On a draft with five slips, the typo pass found
  nothing in 8 of 18 tries before, and in 1 of 12 after.
- The Lab now reads a quote that the AI gives with its paragraph number, or under the
  wrong paragraph number.
- The typo pass discards a "fix" that changes more than four words. One model proposed to
  take nine words out of a sentence.
- When the AI quotes words that are not in the text, the card says so. Before, it said
  that the AI found no slips, or marked nothing.
- When a trim's answer runs out of room, the Lab uses the sentences that came. If they are
  fewer than half, it asks again. A mark or typo pass asks again too. Before, the card
  only said that the AI ran out of room.
- AI alternatives give the model room to think before it answers. Models that think first,
  such as `muse-spark-open`, often gave no words before.
- AI alternatives go in as soon as all of them have come. Before, the app waited for the
  model to stop writing, and threw them away if the model then ran out of room.
- When an answer for alternatives breaks off, the app keeps the suggestions that came
  whole.

## 1.0.3 (2026-10-15)

- In a release, About shows the source commit in place of the build number.

## 1.0.2 (2026-10-15)

- On a Mac where nothing says what a Markdown file is, the Open window showed every `.md`
  file grayed out. It takes `.md`, `.markdown` and `.txt` files on any Mac.

## 1.0.1 (2026-10-14)

- The Lab's typo pass keeps its marks through an edit. Mending a slip by hand takes away
  that slip's mark and leaves the others on their words, and so do an undo and a redo.
  The marking passes do the same.
- Walking through the typos, Fix makes each fix as you go, a step of its own to undo.
  It used to only move on, and nothing changed until Fix all.
- When the Lab took a mark away, the caret could jump, so that what you typed next landed
  elsewhere in the paragraph. It stays where it was.

## 1.0.0 (2026-10-14)

The first release.

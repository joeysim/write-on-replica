# Security

## Reporting a problem

Please do not open a public issue for something that could put a person's key, files or
Mac at risk. Report it privately, one of two ways:

- **Report a vulnerability**, on the repository's Security tab on GitHub, if the button
  is there;
- or write to [address removed].

Say what you found, how to make it happen, and which commit you built. A small file or a
few steps that show it are worth more than a long description.

This is one person's project. Reports are read and answered as time allows, and there is
no bounty.

## What is supported

The latest commit on `main`. There are no releases: you build the app yourself, and a fix
arrives as a commit.

## How the app is meant to behave

So that you can tell a flaw from a decision:

- **The key.** A key typed into Settings is kept in your login keychain. One found in the
  environment or the login shell is held in memory only. The editor's page is never given
  the key: the native side makes each request and hands back text. Nothing prints or logs
  a key, and a key that a service quotes back in an error is taken out before the line is
  shown.
- **Where requests go.** To the address in force (Settings, then the environment, then
  LunaRoute's), with the key in force, and nowhere else: a request is not sent on to
  wherever an answer says the service has moved. A key under LunaRoute's own name in the
  environment is sent to LunaRoute and to no other service. The README says exactly
  [what is sent](README.md#the-ai). There is no telemetry and nothing checks for updates.
- **Plain `http`** reaches only an address on this Mac or its own network (a `.local`
  name, a bare host name, a private address), for a model served there. The app refuses
  it for anywhere else, and macOS does too (as tried on macOS 26), so a key does not
  cross the internet in the clear.
- **The login shell.** To find a key set in `~/.zshrc`, the app runs your login shell
  once, as a terminal would start it, and reads five variables from it.
- **The page.** The web view loads only the app's own page, from inside its bundle, and
  refuses every other navigation. The one thing it asks the browser to open is X's
  compose window, and the native side checks that address.
- **Files.** The app reads and writes the files you open and save, and its own drafts in
  `~/Library/Application Support/Write_On`.

## Known, and deliberate

These are in every copy of the app and are written up in the README. They are not news,
though an argument that one of them is dangerous is welcome:

- Safari's Web Inspector can attach to the page.
- `WRITEON_WEB_ROOT` in the app's environment makes it read the page from another folder.
- Started with `--ui-test`, the app runs a test script in its page. The test harness uses
  methods of `WKWebView` that Apple does not publish.
- The app is signed ad hoc on the Mac that builds it. It is not notarised.

Each needs someone who can already run programs as you, or change how the app is started.

## Not this project's

The AI service you point the app at, and what it does with what you send it. And
Write_On itself, which is Jason Fried's: this is an unofficial replica.

import AppKit

let application = NSApplication.shared
let appDelegate = AppDelegate()
application.delegate = appDelegate
// A scripted run (see UITestHarness) is headless and must leave whoever is using the Mac
// alone. As an accessory it has no Dock icon, is not in the app switcher, and comes to the
// front only if asked to, which nothing does. (`.prohibited` would be stricter, but then
// its window is never shown to WebKit and the page runs as a hidden one.)
application.setActivationPolicy(UITestOptions.parse(CommandLine.arguments) == nil ? .regular : .accessory)
application.run()

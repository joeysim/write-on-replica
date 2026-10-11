import AppKit

let application = NSApplication.shared
let appDelegate = AppDelegate()
application.delegate = appDelegate
// A scripted run (see UITestHarness) must leave whoever is using the Mac alone: as an
// accessory it has no Dock icon and is never brought to the front.
application.setActivationPolicy(UITestOptions.parse(CommandLine.arguments) == nil ? .regular : .accessory)
application.run()

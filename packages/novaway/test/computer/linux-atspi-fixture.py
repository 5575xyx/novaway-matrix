import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, GLib

window = Gtk.Window(title="NovaWay AT-SPI Smoke")
window.set_default_size(360, 160)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
entry = Gtk.Entry()
button = Gtk.Button(label="Click me")
button.set_name("novaway-smoke-button")
entry.connect("changed", lambda *_: button.set_label(entry.get_text() or "Click me"))
button.connect("clicked", lambda *_: button.set_label("Clicked"))
box.pack_start(entry, False, False, 8)
box.pack_start(button, False, False, 8)
window.add(box)
window.connect("destroy", Gtk.main_quit)
window.show_all()
window.set_focus(entry)
GLib.timeout_add(30_000, Gtk.main_quit)
Gtk.main()

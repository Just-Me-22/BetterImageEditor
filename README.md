# BetterImageEditor

An [Equicord](https://github.com/Equicord/Equicord) userplugin that keeps your own pictures
inside Discord's image picker and crop window, for both avatars and banners.

Discord already archives your past avatars, but it stores them **after** cropping, so picking
an old one gives you back the square you cut last time rather than the photo you cut it from.
There is no archive at all for banners. This plugin keeps the file you actually chose, before
the cropper touches it, so you can reframe a picture later instead of hunting for the original
on disk.

It also remembers how you framed each picture. Come back to one and the zoom, rotation and
position are where you left them, so "same photo, a bit higher" is a nudge rather than a redo.

## What it adds

- **Two shelves.** Originals holds the uncropped files you picked. Cropped holds what came out
  of the cropper. A toggle switches between them, and each kind of picture gets its own pair.
- **Paste and drop.** Ctrl+V an image or drop a file straight onto the picker or the crop
  window. No file dialog.
- **Banners.** Discord gives banners no recent-image list whatsoever. They get the same shelves
  as avatars here.
- **Deletable recents.** Discord's archived avatars appear on the cropped shelf with a trash
  button, which removes them from Discord's servers through Discord's own endpoint. That one
  always asks first, because it cannot be undone.
- **Import and export.** Carry your pictures and their crop positions to another device in one
  file.

Picking something off the cropped shelf skips the crop window, since it is already framed, and
goes straight to the profile editor. Originals open the cropper with your last framing restored.
Either way you still press Save Changes yourself, the same as picking a file.

Right click a picture, or use the trash button in its corner, to remove it. Hold Shift to skip
the confirmation on your own pictures.

Everything is stored in an IndexedDB database belonging to the plugin. Nothing is uploaded
anywhere, and full size originals stay on your machine.

Importing merges. Pictures you already have are skipped, so the same file can be imported twice
without making duplicates, and nothing already on the device is thrown away. Discord's own
archive is never touched in either direction.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Library size | 24 | How many pictures to keep on each shelf |
| Restore the crop | on | Puts back the zoom and position you last used for a picture |
| Keep a cropped copy | on | Saves the result each time you finish a crop |
| Ask first | off | Asks before keeping the cropped copy instead of doing it quietly |
| Show Discord's recents | on | Whether Discord's archived avatars appear on the cropped shelf |
| Export, import | | Writes the whole library to a file, or merges one back in |
| Clear saved pictures | | Throws away every picture and every remembered crop |

## License

GPL-3.0-or-later

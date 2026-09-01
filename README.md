# BetterImageEditor

An [Equicord](https://github.com/Equicord/Equicord) userplugin that keeps your own pictures
inside Discord's image picker and crop window, for both avatars and banners.

Discord already archives your past avatars but it stores them after cropping so picking
an old one gives you back the square you cut last time rather than the photo you cut it from.
There is nothing at all for banners. This plugin keeps the file you chose before
the cropper touches it so you can reframe a picture later.

It also remembers how you framed each picture.

## What it adds

- **Two shelves.** Originals holds the uncropped files you picked. Cropped holds what came out
  of the cropper. A toggle switches between them and each kind of picture gets its own pair.
- **Paste and drop.** Pasting an image or drop a picture straight onto the picker or the crop
  window.
- **Banners.** Discord gives banners no recent-image list whatsoever. They get the same shelves
  as avatars here.
- **Deletable recents.** Discord's archived avatars appear on the cropped shelf with a trash
  button, which removes them from Discord's servers through Discord's own endpoint.
- **Pinning.** Pin a picture and the shelf will not drop it to make room for newer ones.
- **A way back.** One button returns you to the avatar you wore before this one.
- **Import and export.** Carry your pictures and their crop positions to another device in one
  file.

Pictures live in an IndexedDB store belonging to the plugin. Nothing is uploaded and the
originals stay on your machine.

## Screenshots

The avatar picker on each shelf.

<p>
  <img src="https://raw.githubusercontent.com/Just-Me-22/BetterImageEditor/assets/screenshots/picker-avatar-originals.png" width="330" alt="Avatar picker, originals shelf">
  <img src="https://raw.githubusercontent.com/Just-Me-22/BetterImageEditor/assets/screenshots/picker-avatar-cropped.png" width="330" alt="Avatar picker, cropped shelf">
</p>

Banners get the same two shelves.

<p>
  <img src="https://raw.githubusercontent.com/Just-Me-22/BetterImageEditor/assets/screenshots/picker-banner-originals.png" width="330" alt="Banner picker, originals shelf">
  <img src="https://raw.githubusercontent.com/Just-Me-22/BetterImageEditor/assets/screenshots/picker-banner-cropped.png" width="330" alt="Banner picker, cropped shelf">
</p>

## License

GPL-3.0-or-later

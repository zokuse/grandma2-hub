# MA2 Hub

A simple, all-in-one companion utility for MA Lighting programmers. Connect directly to your console via Telnet to automate patch workflows, generate timecode, and manage 3D assets.

> **Note:** This is an independent, third-party personal workflow utility shared with the community. It is not affiliated with, endorsed by, or associated with MA Lighting in any way. Use it at your own risk!

## Features

- **Direct Connection:** Send commands and pull patch data directly from the console via Telnet.
- **Workflow Tools:** Visual fixture cloner, XYZ position injector, and DMX patch viewer.
- **Timecode Generator:** Convert REAPER `.rpp` projects directly into MA2 XML timecode shows.
- **3D Assets:** Simple `gltf`/`glb` unpacker for your 3D models.

## Development

To run the app locally:

```bash
npm install
npm start
```

To build a Windows installer (`.exe`):

```bash
npm run build-installer
```

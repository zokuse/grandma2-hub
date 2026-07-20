# MA2 Hub

A simple, all-in-one companion utility for MA Lighting programmers. Connect directly to your console via Telnet to automate patch workflows, generate timecode, and manage 3D assets.

> **Note:** This is an independent, third-party personal workflow utility shared with the community. It is not affiliated with, endorsed by, or associated with MA Lighting in any way. Use it at your own risk!

## Included Tools

- **Visual Cloner:** Visually map clone sources to destinations from your layouts and automatically push the clone macros to the console.
- **DMX View:** A visual footprint of your universes. See channel occupancy, fixture counts, and color-coded layers at a glance.
- **Patch List:** Pull your current patch straight from the console and export clean, professional PDF reports for your crew.
- **XYZ Injector:** Map real-world 3D spatial coordinates from pre-viz software (like Capture) directly into your MA2 patch.
- **Timecode Cues:** Generate MA2 XML timecode shows directly from REAPER `.rpp` project markers with auto-assigned sequences.
- **glTF Unpacker:** Easily unpack and manage `.glb`/`.gltf` 3D model files for MA2 3D environment integration.

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

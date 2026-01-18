---
description: How to update the project screenshot and version
---

Follow these steps to update the visual documentation for HyperZenith:

1. **Capture**: Take a screenshot of the application window.
2. **Rename**: Save the image as `screenshot_vX.X.X.png` (replace X.X.X with your current version) in the root directory.
3. **Markdown Update**: 
   - Open [README.md](file:///c:/Users/Ayush/.gemini/antigravity/scratch/hyperzenith/README.md).
   - Update the image link: `![HyperZenith UI](screenshot_vX.X.X.png)`.
   - Update the version badge at the top: `https://img.shields.io/badge/version-X.X.X-cyan`.
4. **Metadata Update**:
   - Open [package.json](file:///c:/Users/Ayush/.gemini/antigravity/scratch/hyperzenith/package.json).
   - Update the `"version"` field to match.
5. **Clean Up**: Delete the old screenshot file to keep the repository size small.

// turbo
6. **Commit**: `git add .`, `git commit -m "docs: update screenshot to vX.X.X"`, `git push`

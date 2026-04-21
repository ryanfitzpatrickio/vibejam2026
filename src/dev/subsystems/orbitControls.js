export function installOrbitControls(editor) {
  editor.controls = new editor.OrbitControls(editor.app.camera, editor.app.renderer.domElement);
  editor.controls.enabled = false;
  editor.controls.enableDamping = true;
  editor.controls.dampingFactor = 0.08;
  editor.controls.enablePan = true;
  editor.controls.screenSpacePanning = true;
  editor.controls.minDistance = 1.5;
  editor.controls.maxDistance = 120;
}

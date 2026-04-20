import { deepClone } from '../editorShared.js';

export function installTransformControls(editor) {
  editor.transformControls = new editor.TransformControls(editor.app.camera, editor.app.renderer.domElement);
  editor.transformControls.enabled = false;
  editor.transformControls.setMode('translate');
  editor.transformControls.size = 0.85;
  editor.transformControlsHelper = editor.transformControls.getHelper();
  editor.transformControlsHelper.userData.editorHelper = true;
  editor.transformControls.addEventListener('dragging-changed', (event) => {
    editor.controls.enabled = !event.value && editor.visible;
    if (!event.value) {
      editor.layout = editor.app.room.getEditableLayout();
      editor._syncForm();
      attachTransformControls(editor);
    }
  });
  editor.transformControls.addEventListener('objectChange', () => {
    if (editor._suppressTransformSync) return;
    const object = editor.transformControls.object;
    const primitiveId = object?.userData?.primitiveId;
    const prefabInstanceId = object?.userData?.prefabInstanceId;
    const lightId = object?.userData?.lightId;
    const portalId = object?.userData?.portalId;
    const extractionPortalId = object?.userData?.extractionPortalId;
    const raidTaskId = object?.userData?.raidTaskId;
    const ropeId = object?.userData?.ropeId;
    const vegetationId = object?.userData?.vegetationId;
    if (!primitiveId && !prefabInstanceId && !lightId && !portalId && !ropeId && !extractionPortalId && !raidTaskId && !vegetationId) {
      return;
    }

    const primitive = primitiveId
      ? editor.layout.primitives.find((entry) => entry.id === primitiveId)
      : null;
    const light = lightId
      ? (editor.layout.lights ?? []).find((entry) => entry.id === lightId)
      : null;
    const portal = portalId
      ? (editor.layout.portals ?? []).find((entry) => entry.id === portalId)
      : null;
    const extraction = extractionPortalId
      ? (editor.layout.extractionPortals ?? []).find((entry) => entry.id === extractionPortalId)
      : null;
    const raidTask = raidTaskId
      ? (editor.layout.raidTasks ?? []).find((entry) => entry.id === raidTaskId)
      : null;
    const rope = ropeId
      ? (editor.layout.ropes ?? []).find((entry) => entry.id === ropeId)
      : null;
    const vegetation = vegetationId
      ? (editor.layout.vegetation ?? []).find((entry) => entry.id === vegetationId)
      : null;
    const mode = editor.transformMode || editor.transformControls?.mode || 'translate';
    const isGlb = primitive?.type === 'glb';
    const next = primitive
      ? editor.app.room.snapPrimitiveToGrid({
        ...deepClone(primitive),
        position: {
          x: object.position.x,
          y: object.position.y,
          z: object.position.z,
        },
        rotation: {
          x: object.rotation.x,
          y: object.rotation.y,
          z: object.rotation.z,
        },
        scale: {
          x: object.scale.x,
          y: object.scale.y,
          z: object.scale.z,
        },
      }, {
        snapY: true,
        snapPosition: mode !== 'scale',
        snapScale: mode === 'scale' && !isGlb,
        allowEdgeOverflow: true,
      })
      : light
        ? editor.app.room.snapLightToGrid({
          ...deepClone(light),
          position: {
            x: object.position.x,
            y: object.position.y,
            z: object.position.z,
          },
          rotation: {
            x: object.rotation.x,
            y: object.rotation.y,
            z: object.rotation.z,
          },
        }, {
          snapY: true,
          snapPosition: true,
          allowEdgeOverflow: true,
        })
      : rope
        ? editor.app.room.snapRopeToGrid({
          ...deepClone(rope),
          anchor: {
            x: object.position.x,
            y: object.position.y,
            z: object.position.z,
          },
        }, {
          snapY: true,
          snapPosition: true,
          allowEdgeOverflow: true,
        })
        : extraction
          ? editor.app.room.snapExtractionPortalToGrid({
            ...deepClone(extraction),
            position: {
              x: object.position.x,
              y: object.position.y,
              z: object.position.z,
            },
            rotation: {
              x: object.rotation.x,
              y: object.rotation.y,
              z: object.rotation.z,
            },
          }, {
            snapY: true,
            snapPosition: true,
            allowEdgeOverflow: true,
          })
          : raidTask
            ? editor.app.room.snapRaidTaskToGrid({
              ...deepClone(raidTask),
              position: {
                x: object.position.x,
                y: object.position.y,
                z: object.position.z,
              },
              rotation: {
                x: object.rotation.x,
                y: object.rotation.y,
                z: object.rotation.z,
              },
            }, {
              snapY: true,
              snapPosition: true,
              allowEdgeOverflow: true,
            })
            : portal
              ? editor.app.room.snapPortalToGrid({
                ...deepClone(portal),
                position: {
                  x: object.position.x,
                  y: object.position.y,
                  z: object.position.z,
                },
                rotation: {
                  x: object.rotation.x,
                  y: object.rotation.y,
                  z: object.rotation.z,
                },
              }, {
                snapY: true,
                snapPosition: true,
                allowEdgeOverflow: true,
              })
              : vegetation
                ? editor.app.room.snapVegetationToGrid({
                  ...deepClone(vegetation),
                  position: {
                    x: object.position.x,
                    y: object.position.y,
                    z: object.position.z,
                  },
                  rotation: {
                    x: object.rotation.x,
                    y: object.rotation.y,
                    z: object.rotation.z,
                  },
                  scale: {
                    x: object.scale.x,
                    y: object.scale.y,
                    z: object.scale.z,
                  },
                }, {
                  snapY: true,
                  snapPosition: mode !== 'scale',
                  snapScale: mode === 'scale',
                  allowEdgeOverflow: true,
                })
              : {
        position: {
          x: Number(object.position.x.toFixed(4)),
          y: Number(object.position.y.toFixed(4)),
          z: Number(object.position.z.toFixed(4)),
        },
        rotation: {
          x: Number(object.rotation.x.toFixed(4)),
          y: Number(object.rotation.y.toFixed(4)),
          z: Number(object.rotation.z.toFixed(4)),
        },
        scale: {
          x: Number(object.scale.x.toFixed(4)),
          y: Number(object.scale.y.toFixed(4)),
          z: Number(object.scale.z.toFixed(4)),
        },
              };

    const nextPos = next.position ?? next.anchor ?? { x: 0, y: 0, z: 0 };
    const nextRot = next.rotation ?? { x: 0, y: 0, z: 0 };
    editor._suppressTransformSync = true;
    object.position.set(nextPos.x, nextPos.y, nextPos.z);
    object.rotation.set(nextRot.x, nextRot.y, nextRot.z);
    if (next.scale) {
      object.scale.set(next.scale.x, next.scale.y, next.scale.z);
    } else {
      object.scale.set(1, 1, 1);
    }
    editor._suppressTransformSync = false;

    if (lightId) {
      editor.app.room.updateEditableLightTransform(lightId, {
        position: next.position,
        rotation: next.rotation,
      });
    } else if (extractionPortalId) {
      editor.app.room.updateEditableExtractionPortalTransform(extractionPortalId, {
        position: next.position,
        rotation: next.rotation,
      });
    } else if (raidTaskId) {
      editor.app.room.updateEditableRaidTaskTransform(raidTaskId, {
        position: next.position,
        rotation: next.rotation,
      });
    } else if (portalId) {
      editor.app.room.updateEditablePortalTransform(portalId, {
        position: next.position,
        rotation: next.rotation,
      });
    } else if (ropeId) {
      editor.app.room.updateEditableRopeTransform(ropeId, {
        anchor: next.anchor,
      });
    } else if (vegetationId) {
      editor.app.room.updateEditableVegetationTransform(vegetationId, {
        position: next.position,
        rotation: next.rotation,
        scale: next.scale,
      });
    } else {
      editor.app.room.updateEditablePrimitiveTransform(primitiveId || prefabInstanceId, {
        position: next.position,
        rotation: next.rotation,
        scale: next.scale,
      });
    }
    editor.layout = editor.app.room.getEditableLayout();
    editor._syncForm();
  });
  editor.app.scene.add(editor.transformControlsHelper);
}

export function setTransformMode(editor, mode) {
  const isRope = !!editor._selectedRope?.();
  const effective = isRope ? 'translate' : mode;
  editor.transformMode = effective;
  editor.transformControls?.setMode(effective);
  if (isRope && mode !== 'translate') {
    editor._setStatus('Ropes only support translate (anchor).');
  } else {
    editor._setStatus(`Transform mode: ${effective}`);
  }
}

export function attachTransformControls(editor) {
  if (!editor.transformControls || !editor.visible) return;
  const object = editor.app.room.getEditableObject(editor.selectedId);
  if (!object || object.visible === false) {
    editor.transformControls.detach();
    return;
  }
  if (editor._selectedRope?.() && editor.transformControls.mode !== 'translate') {
    editor.transformMode = 'translate';
    editor.transformControls.setMode('translate');
  }
  editor.transformControls.attach(object);
}

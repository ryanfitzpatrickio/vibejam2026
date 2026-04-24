import { createSection, createNumberField, createRangeField } from '../ui/fields.js';

export function installFanSection(editor) {
  const section = createSection(editor.panel, 'Ceiling Fan');
  editor.fanSection = section;

  editor.fanBladeCountInput = createNumberField(section, 'Blade Count', {
    step: 1,
    min: 2,
    max: 8,
  }, (value) => {
    editor._updateSelected((fan) => {
      fan.bladeCount = Math.max(2, Math.min(8, Math.round(value || 4)));
    });
  });

  editor.fanBladeLengthInput = createRangeField(section, 'Blade Length', 0.45, 3.4, 0.01, (value) => {
    editor._updateSelected((fan) => {
      fan.bladeLength = value;
    });
  });

  editor.fanBladeWidthInput = createRangeField(section, 'Blade Width', 0.08, 0.8, 0.01, (value) => {
    editor._updateSelected((fan) => {
      fan.bladeWidth = value;
    });
  });

  editor.fanHubRadiusInput = createRangeField(section, 'Hub Radius', 0.08, 0.75, 0.01, (value) => {
    editor._updateSelected((fan) => {
      fan.hubRadius = value;
    });
  });

  editor.fanRodLengthInput = createRangeField(section, 'Rod Length', 0.08, 1.5, 0.01, (value) => {
    editor._updateSelected((fan) => {
      fan.rodLength = value;
    });
  });

  editor.fanSpinSpeedInput = createRangeField(section, 'Spin Speed', 0.1, 12, 0.05, (value) => {
    editor._updateSelected((fan) => {
      fan.spinSpeed = value;
    });
  });

  editor.fanCheeseAmountInput = createNumberField(section, 'Center Cheese', {
    step: 1,
    min: 1,
    max: 99,
  }, (value) => {
    editor._updateSelected((fan) => {
      fan.cheeseAmount = Math.max(1, Math.min(99, Math.round(value || 12)));
    });
  });
}

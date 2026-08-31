const { ValidationError } = require('./errors');

const MAX_BRAND_LENGTH = 80;
const MAX_ADG_LENGTH = 64;
const MAX_COMPONENT_LENGTH = 100;
const MAX_PERIOD_DIGITS = 9;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertAllowedKeys(value, allowed, name) {
  if (!isPlainObject(value)) {
    throw new ValidationError(`${name} must be an object.`);
  }
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unexpected) {
    throw new ValidationError(`${name} contains an unsupported field: ${unexpected}.`);
  }
}

function safeText(value, name, { maxLength, allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${name} must be a string.`);
  }
  const result = value.trim();
  if (!allowEmpty && result.length === 0) {
    throw new ValidationError(`${name} is required.`);
  }
  if (result.length > maxLength) {
    throw new ValidationError(`${name} must be ${maxLength} characters or fewer.`);
  }
  if (CONTROL_CHARACTERS.test(result)) {
    throw new ValidationError(`${name} contains invalid control characters.`);
  }
  return result;
}

function validateBrand(value, name = 'brand') {
  return safeText(value, name, { maxLength: MAX_BRAND_LENGTH });
}

function validateAdg(value, name = 'adg') {
  const result = safeText(value, name, { maxLength: MAX_ADG_LENGTH });
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(result)) {
    throw new ValidationError(`${name} contains unsupported characters.`);
  }
  return result;
}

function validatePeriodValue(value, name) {
  if (value === undefined || value === '') return '';
  let result = value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    result = String(value);
  }
  if (typeof result !== 'string' || !new RegExp(`^\\d{1,${MAX_PERIOD_DIGITS}}$`).test(result.trim())) {
    throw new ValidationError(`${name} must be a non-negative whole number.`);
  }
  return result.trim();
}

function validateVehicleMutation(body, componentCategories) {
  assertAllowedKeys(
    body,
    ['brand', 'adg', 'noClutch', 'exclusionMode', 'components', 'overridePeriod'],
    'Request body'
  );

  const brand = validateBrand(body.brand);
  const adg = validateAdg(body.adg);
  if (typeof body.noClutch !== 'boolean') {
    throw new ValidationError('noClutch must be a boolean.');
  }
  if (!['inherit', 'brand', 'adg_override'].includes(body.exclusionMode)) {
    throw new ValidationError('exclusionMode must be inherit, brand, or adg_override.');
  }

  if (body.exclusionMode === 'brand') {
    if (!Array.isArray(body.components) || body.components.length === 0 || body.components.length > componentCategories.length) {
      throw new ValidationError('components must contain between one and nine entries.');
    }

    const components = body.components.map((entry, index) => {
      assertAllowedKeys(entry, ['component', 'months', 'km'], `components[${index}]`);
      const component = safeText(entry.component, `components[${index}].component`, {
        maxLength: MAX_COMPONENT_LENGTH,
      });
      if (!componentCategories.includes(component)) {
        throw new ValidationError(`components[${index}].component is not a supported category.`);
      }
      return {
        component,
        months: validatePeriodValue(entry.months, `components[${index}].months`),
        km: validatePeriodValue(entry.km, `components[${index}].km`),
      };
    });

    if (new Set(components.map((entry) => entry.component)).size !== components.length) {
      throw new ValidationError('components cannot contain duplicates.');
    }

    return { brand, adg, noClutch: body.noClutch, exclusionMode: body.exclusionMode, components };
  }

  if (body.components !== undefined) {
    throw new ValidationError('components is only valid when exclusionMode is brand.');
  }

  if (body.exclusionMode === 'adg_override') {
    assertAllowedKeys(body.overridePeriod, ['months', 'km'], 'overridePeriod');
    const months = validatePeriodValue(body.overridePeriod.months, 'overridePeriod.months');
    const km = validatePeriodValue(body.overridePeriod.km, 'overridePeriod.km');
    if (!months && !km) {
      throw new ValidationError('overridePeriod must include months or km.');
    }
    return {
      brand,
      adg,
      noClutch: body.noClutch,
      exclusionMode: body.exclusionMode,
      overridePeriod: { months, km },
    };
  }

  if (body.overridePeriod !== undefined) {
    throw new ValidationError('overridePeriod is only valid when exclusionMode is adg_override.');
  }
  return { brand, adg, noClutch: body.noClutch, exclusionMode: body.exclusionMode };
}

function validatePendingMutation(body) {
  assertAllowedKeys(body, ['brand', 'adg', 'clearAll', 'unignoreAdg'], 'Request body');

  if (body.unignoreAdg !== undefined) {
    if (Object.keys(body).some((key) => !['unignoreAdg'].includes(key))) {
      throw new ValidationError('unignoreAdg cannot be combined with another action.');
    }
    return { action: 'unignore', adg: validateAdg(body.unignoreAdg, 'unignoreAdg') };
  }

  if (body.clearAll === true) {
    if (body.adg !== undefined) {
      throw new ValidationError('adg cannot be combined with clearAll.');
    }
    return { action: 'clear', brand: validateBrand(body.brand) };
  }

  if (body.clearAll !== undefined && body.clearAll !== false) {
    throw new ValidationError('clearAll must be a boolean.');
  }
  return {
    action: 'discard',
    brand: validateBrand(body.brand),
    adg: validateAdg(body.adg),
  };
}

module.exports = {
  isPlainObject,
  assertAllowedKeys,
  safeText,
  validateBrand,
  validateAdg,
  validatePeriodValue,
  validateVehicleMutation,
  validatePendingMutation,
};

class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR', expose = false) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.expose = expose;
  }
}

class ConfigurationError extends AppError {
  constructor(message) {
    super(message, 503, 'CONFIGURATION_ERROR', true);
    this.name = 'ConfigurationError';
  }
}

class StorageError extends AppError {
  constructor(message) {
    super(message, 503, 'STORAGE_ERROR', false);
    this.name = 'StorageError';
  }
}

class ValidationError extends AppError {
  constructor(message, status = 400) {
    super(message, status, 'VALIDATION_ERROR', true);
    this.name = 'ValidationError';
  }
}

class PayloadTooLargeError extends ValidationError {
  constructor(message = 'Request payload is too large.') {
    super(message, 413);
    this.name = 'PayloadTooLargeError';
    this.code = 'PAYLOAD_TOO_LARGE';
  }
}

module.exports = {
  AppError,
  ConfigurationError,
  StorageError,
  ValidationError,
  PayloadTooLargeError,
};

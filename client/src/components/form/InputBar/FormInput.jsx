import { useId, useState } from 'react';
import PropTypes from 'prop-types';
import { Eye, EyeOff } from 'lucide-react';

import styles from './FormInput.module.css';

export default function FormInput({
  register,
  error,
  label,
  fieldLabel,
  placeholder,
  mainIcon,
  onChange,
  type = 'text',
  autoComplete,
}) {
  const isPassword = type === 'password';
  const [isRevealed, setIsRevealed] = useState(false);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  // react-hook-form's `register` returns its own `onChange`. Spreading it and
  // then also passing the caller's `onChange` would silently drop one of them,
  // so compose explicitly: RHF first (it owns validation state), caller second.
  const { onChange: registerOnChange, ...field } = register(label);

  const handleChange = (event) => {
    registerOnChange(event);
    if (onChange) onChange(event);
  };

  return (
    <div className={styles.container}>
      {/* A real, associated <label>. Placeholders were doing this job before,
          which leaves the field with no accessible name once the user types
          and no name at all for a screen reader on an empty form. */}
      <label htmlFor={inputId} className={fieldLabel ? styles.label : 'srOnly'}>
        {fieldLabel || placeholder || label}
      </label>

      <div className={`${styles.input} ${error ? styles.inputError : ''}`}>
        {mainIcon && (
          <span className={styles.icon} aria-hidden="true">
            {mainIcon}
          </span>
        )}

        <input
          {...field}
          id={inputId}
          onChange={handleChange}
          type={isPassword && !isRevealed ? 'password' : 'text'}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
        />

        {isPassword && (
          // Rendered by the component rather than supplied by each caller —
          // the call sites previously passed the show/hide icons in opposite
          // orders, so one screen displayed the inverted state.
          <button
            type="button"
            onClick={() => setIsRevealed((revealed) => !revealed)}
            className={styles.toggle}
            aria-label={isRevealed ? 'Hide password' : 'Show password'}
            aria-pressed={isRevealed}
          >
            {isRevealed ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        )}
      </div>

      {error?.message && (
        <p id={errorId} className={styles.error} role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}

FormInput.propTypes = {
  label: PropTypes.string.isRequired,
  fieldLabel: PropTypes.string,
  error: PropTypes.object,
  type: PropTypes.string,
  placeholder: PropTypes.string,
  mainIcon: PropTypes.element,
  onChange: PropTypes.func,
  autoComplete: PropTypes.string,
  register: PropTypes.func.isRequired,
};

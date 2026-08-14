import PropTypes from 'prop-types';
import styles from './Text.module.css';

const STEP_CLASS = {
  1: styles.stepOne,
  2: styles.stepTwo,
  3: styles.stepThree,
  4: styles.stepFour,
  5: styles.stepFive,
  6: styles.stepSix,
  7: styles.stepSeven,
  8: styles.stepEight,
};

/**
 * Typographic primitive.
 *
 * `as` exists because this component always rendered a <p>, so every heading
 * in the app was a paragraph that merely looked large. Screen-reader users got
 * no document outline at all. Callers now pass the element that is
 * semantically correct, and the visual size stays independent of it via `step`.
 */
export default function Text({
  children = '',
  as: Component = 'p',
  step = 3,
  weight = '400',
  color,
  style,
  className = '',
  fontFamily,
  ...rest
}) {
  const stepStyle = STEP_CLASS[step] || styles.stepThree;

  const fontStyles = {
    fontWeight: weight,
    ...(color ? { color } : null),
    ...(fontFamily ? { fontFamily } : null),
    ...style,
  };

  return (
    <Component
      style={fontStyles}
      className={[stepStyle, styles.text, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </Component>
  );
}

Text.propTypes = {
  as: PropTypes.elementType,
  step: PropTypes.number,
  weight: PropTypes.string,
  color: PropTypes.string,
  style: PropTypes.object,
  children: PropTypes.node,
  className: PropTypes.string,
  fontFamily: PropTypes.string,
};

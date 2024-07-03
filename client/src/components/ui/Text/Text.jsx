import PropTypes from 'prop-types';
import styles from './Text.module.css';

export default function Text({
  children = '',
  step = 3,
  weight = '400',
  color = 'inherit',
  style,
  className,
  fontFamily, 
}) {
  let stepStyle;

  switch (step) {
    case 1:
      stepStyle = styles.stepOne;
      break;
    case 2:
      stepStyle = styles.stepTwo;
      break;
    case 3:
      stepStyle = styles.stepThree;
      break;
    case 4:
      stepStyle = styles.stepFour;
      break;
    case 5:
      stepStyle = styles.stepFive;
      break;
    case 6:
      stepStyle = styles.stepSix;
      break;
    case 7:
      stepStyle = styles.stepSeven;
      break;
    case 8:
      stepStyle = styles.stepEight;
      break;
    default:
      stepStyle = styles.stepThree; 
  }

  const fontStyles = {
    fontWeight: weight,
    color: color,
    fontFamily: fontFamily, 
    ...style,
  };

  return (
    <p style={fontStyles} className={`${stepStyle} ${styles.text} ${className}`}>
      {children}
    </p>
  );
}

Text.propTypes = {
  step: PropTypes.number,
  weight: PropTypes.string,
  color: PropTypes.string,
  style: PropTypes.object,
  children: PropTypes.any,
  className: PropTypes.string,
  fontFamily: PropTypes.string, 
};

import React from 'react';
import styles from './Tooltip.module.css';

const Tooltip = ({ tooltipText, children, width,height,position, color }) => {
    const style = {
        '--tooltip-width': width || '40px',
        '--tooltip-height': height || '40px',
        '--position' : position || 'absolute',
        '--text-color' : color || '#333'
      };
  return (
    
    <div className={styles.tooltipContainer} style={style}>
      <span className={styles.tooltip}>{tooltipText}</span>
      <span className={styles.text}>{children}</span>
    </div>
  );
};

export default Tooltip;

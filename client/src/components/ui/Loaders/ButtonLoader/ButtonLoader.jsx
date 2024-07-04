// LineLoader.jsx
import React from 'react';
import { LineWave } from 'react-loader-spinner';
import styles from './buttonloader.module.css';

const LineLoader = () => {
  return (
    <div className={styles.loaderContainer}>
      <LineWave
        height={16} 
        width={200} 
        color="#fff"
        ariaLabel="line-wave"
        margin = 'none'
      />
    </div>
  );
};

export default LineLoader;

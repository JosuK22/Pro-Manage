import React from 'react';
import styles from './astronut.module.css';

const Astronaut = () => (
  <div data-js="astro" className={styles.astronaut}>
    <div className={styles.head}></div>
    <div className={`${styles.arm} ${styles['arm-left']}`}></div>
    <div className={`${styles.arm} ${styles['arm-right']}`}></div>
    <div className={styles.body}>
      <div className={styles.panel}></div>
    </div>
    <div className={`${styles.leg} ${styles['leg-left']}`}></div>
    <div className={`${styles.leg} ${styles['leg-right']}`}></div>
    <div className={styles.schoolbag}></div>
  </div>
);

export default Astronaut;

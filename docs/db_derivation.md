# Microphone Amplitude to Decibel (dB SPL) Derivation Methodology

## 1. Introduction & Background

In acoustic monitoring applications, converting digital audio signals captured by commercial smartphone hardware into meaningful acoustic sound measurements is a non-trivial challenge. Consumer mobile devices provide audio metering in units of **decibels relative to full scale (dBFS)** rather than physical **Sound Pressure Level (dB SPL)**.

This document outlines the theoretical distinction between dBFS and dB SPL, details the calibration offset used in this Community Noise Map project, and documents the rationale for the selected parameters.

---

## 2. Theoretical Distinction: dBFS vs. Sound Pressure Level (SPL)

### Digital Full Scale (dBFS)
Audio metering libraries such as Expo's `expo-av` report signal amplitude in **dBFS** (decibels relative to Full Scale):

$$\text{dBFS} = 20 \log_{10}\left(\frac{A}{A_{\text{max}}}\right)$$

- $A$ represents the root-mean-square (RMS) amplitude of the incoming quantized digital signal.
- $A_{\text{max}}$ represents the maximum permissible digital value before clipping occurs (e.g., $1.0$ for floating-point audio or $32,767$ for signed 16-bit PCM).
- Because $A \le A_{\text{max}}$, dBFS values are always non-positive ($\le 0\text{ dBFS}$), with $0\text{ dBFS}$ corresponding to the threshold of digital saturation (clipping).

### Acoustic Sound Pressure Level (dB SPL)
Physical sound waves travel through air as mechanical pressure fluctuations. Sound Pressure Level is an absolute physical metric defined against the standard human threshold of hearing at $1\text{ kHz}$:

$$\text{dB SPL} = 20 \log_{10}\left(\frac{P}{P_0}\right)$$

- $P$ is the RMS acoustic pressure in Pascals ($\text{Pa}$).
- $P_0 = 20\,\mu\text{Pa} = 20 \times 10^{-6}\,\text{Pa}$ (the international reference pressure).
- Normal conversational speech is typically $60\text{ to }65\text{ dB SPL}$, quiet library environments are $35\text{ to }40\text{ dB SPL}$, and busy urban street traffic ranges between $70\text{ and }85\text{ dB SPL}$.

### Why dBFS $\ne$ dB SPL
1. **Reference Base:** dBFS is referenced to digital saturation, whereas dB SPL is referenced to an absolute physical pressure ($20\,\mu\text{Pa}$).
2. **Hardware Sensitivities & Analog Gain:** Micro-Electro-Mechanical Systems (MEMS) microphones found in modern smartphones have varying analog sensitivity ratings (typically between $-42\text{ dBV/Pa}$ and $-26\text{ dBV/Pa}$), pre-amplifier gains, analog-to-digital converters (ADCs), and automatic gain control (AGC) or noise-cancellation DSP filters.
3. **Absence of Hardware Calibration:** Standard operating system audio APIs do not expose calibrated acoustic voltage-to-Pascal transfer functions.

---

## 3. Mathematical Conversion & Calibration Formula

To translate normalized digital amplitude into an approximate Sound Pressure Level, an empirical linear shift model is applied:

$$\text{SPL} \approx \text{dBFS} + \text{CalibrationOffset}$$

### Chosen Calibration Offset
The calibration offset chosen for this project is:

$$\text{CalibrationOffset} = 95.0\text{ dB}$$

Therefore, the conversion formula implemented in the application is:

$$\text{SPL} = \text{dBFS} + 95.0$$

---

## 4. Technical Rationale for the Chosen Offset

The selection of **$95.0\text{ dB}$** as the calibration offset is grounded in empirical acoustic research and smartphone hardware specifications:

1. **Acoustic Overload Point (AOP):**
   Modern smartphone MEMS microphones (such as Knowles or TDK InvenSense sensors) typically feature an Acoustic Overload Point between $115\text{ dB SPL}$ and $125\text{ dB SPL}$. In standard mobile operating system audio stacks (iOS CoreAudio and Android OpenSL / AAudio), unity digital gain ($0\text{ dBFS}$) is mapped safely below the physical clipping threshold to prevent clipping of loud vocal bursts, generally aligning $0\text{ dBFS}$ with approximately $95\text{ to }105\text{ dB SPL}$.

2. **Ambient Baseline Alignment:**
   - In a standard room with background noise of roughly $40\text{ to }45\text{ dB SPL}$, mobile devices typically measure metering levels around $-55\text{ to }-50\text{ dBFS}$.
     $$\text{SPL} = -52\text{ dBFS} + 95.0\text{ dB} = 43.0\text{ dB SPL}$$
   - During normal spoken conversation ($1\text{ meter}$ distance), speech produces approximately $60\text{ to }65\text{ dB SPL}$, which corresponds to metering values around $-35\text{ to }-30\text{ dBFS}$.
     $$\text{SPL} = -33\text{ dBFS} + 95.0\text{ dB} = 62.0\text{ dB SPL}$$
   - Heavy urban street noise ($75\text{ to }80\text{ dB SPL}$) yields meter readings of roughly $-20\text{ to }-15\text{ dBFS}$.
     $$\text{SPL} = -18\text{ dBFS} + 95.0\text{ dB} = 77.0\text{ dB SPL}$$

3. **Clamping & Guard Rails:**
   To guarantee realistic sound measurement data and avoid unphysical artifacts:
   - Output decibel readings are bounded between a plausible minimum ($30.0\text{ dB}$) and maximum ($120.0\text{ dB}$).
   - Decibel values are formatted to one decimal precision, consistent with Type 2 sound level meters.

---

## 5. Summary

While high-precision scientific acoustic surveys require specialized Type 1 sound level meters and anechoic chamber calibration per device model, the linear approximation:

$$\text{SPL} \approx \text{dBFS} + 95.0$$

provides an effective, robust, and accessible standard for crowdsourced urban noise mapping across mobile user populations.

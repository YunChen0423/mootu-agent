const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export function createLiveSensing({ video, onSignal, onTranscript, onStatus }) {
  let stream = null;
  let audioContext = null;
  let analyser = null;
  let audioFrame = null;
  let videoTimer = null;
  let recognition = null;
  let lastRecognizedAt = 0;
  let noiseFloor = 0.012;
  let recognitionAvailable = false;
  let previousPixels = null;
  let latestVideo = { motion: 0, brightness: 0 };

  const canvas = document.createElement("canvas");
  canvas.width = 80;
  canvas.height = 45;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  function analyzeVideo() {
    if (!stream || video.readyState < 2) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let brightness = 0;
    let difference = 0;
    const gray = new Uint8Array(canvas.width * canvas.height);
    for (let pixel = 0, index = 0; pixel < pixels.length; pixel += 4, index += 1) {
      const value = Math.round(pixels[pixel] * 0.299 + pixels[pixel + 1] * 0.587 + pixels[pixel + 2] * 0.114);
      gray[index] = value;
      brightness += value;
      if (previousPixels) difference += Math.abs(value - previousPixels[index]);
    }
    latestVideo = {
      brightness: brightness / gray.length / 255,
      motion: previousPixels ? difference / gray.length / 255 : 0
    };
    previousPixels = gray;
  }

  function analyzeAudio() {
    if (!stream || !analyser) return;
    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    let energy = 0;
    samples.forEach((sample) => { energy += ((sample - 128) / 128) ** 2; });
    const rms = Math.sqrt(energy / samples.length);
    const now = performance.now();
    const recentlyRecognized = recognitionAvailable && now - lastRecognizedAt < 4200;
    if (!recentlyRecognized) noiseFloor = noiseFloor * 0.992 + rms * 0.008;
    const audioActive = rms > Math.max(0.025, noiseFloor * 1.8);
    const speaking = recentlyRecognized && audioActive;
    const silenceSeconds = Math.max(0, (now - lastRecognizedAt) / 1000);
    onSignal({
      audioLevel: clamp(rms * 5),
      audioActive,
      speaking,
      silenceSeconds,
      motion: latestVideo.motion,
      brightness: latestVideo.brightness
    });
    audioFrame = requestAnimationFrame(analyzeAudio);
  }

  function startRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      recognitionAvailable = false;
      onStatus("当前浏览器不支持实时语音识别；只能显示环境声音，无法把背景音确认成讲话。");
      return;
    }
    recognitionAvailable = true;
    recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "zh-CN";
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const text = event.results[index][0].transcript;
        if (event.results[index].isFinal) finalText += text;
        else interimText += text;
      }
      if (finalText.trim() || interimText.trim()) lastRecognizedAt = performance.now();
      onTranscript({ finalText, interimText });
    };
    recognition.onerror = (event) => {
      if (!['no-speech', 'aborted'].includes(event.error)) onStatus(`语音识别暂不可用：${event.error}`);
    };
    recognition.onend = () => {
      if (stream) {
        try { recognition.start(); } catch {}
      }
    };
    try { recognition.start(); } catch {}
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持摄像头与麦克风访问");
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    video.srcObject = stream;
    video.controls = false;
    video.muted = true;
    video.autoplay = true;
    video.hidden = false;
    await video.play();

    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    lastRecognizedAt = performance.now();
    noiseFloor = 0.012;
    audioFrame = requestAnimationFrame(analyzeAudio);
    videoTimer = setInterval(analyzeVideo, 500);
    startRecognition();
    return true;
  }

  async function stop() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (audioFrame) cancelAnimationFrame(audioFrame);
    if (videoTimer) clearInterval(videoTimer);
    if (recognition) {
      recognition.onend = null;
      try { recognition.stop(); } catch {}
    }
    if (audioContext) await audioContext.close();
    video.srcObject = null;
    video.autoplay = false;
    video.muted = false;
    video.controls = true;
    previousPixels = null;
  }

  return { start, stop, get active() { return Boolean(stream); } };
}

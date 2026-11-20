# 合成 AAC 网络回归样本

`synthetic-mpeg2-aac-lc.aac` 为本项目生成的自有正弦 PCM 编码结果，不含广播或其他第三方录音。

生成方式：Microsoft Edge WebCodecs `AudioEncoder`，`codec=mp4a.40.2`、44100 Hz、双声道、128000 bit/s；输入 16 个 1024 帧的 `f32-planar` 块，左声道 440 Hz、右声道 660 Hz、振幅 0.12。编码器输出的 AudioSpecificConfig 为 `12 10`。每个原始 AAC packet 封装为 MPEG-2、无 CRC、单 raw data block 的 ADTS 帧（`FF F9`），payload 保持编码器原字节。

此样本只验证既有 AAC-LC 解码器与网络 ADTS 分帧兼容；不代表全部 AAC profiles、编码器或公网电台组合均已实测。

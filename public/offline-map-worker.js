/* Disposable query worker: the city dataset dies with the worker after lookup. */
self.window = self;
self.onmessage = ({ data }) => {
  try {
    importScripts("offline-map-model.js", "offline-map-data.js");
    const result = self.OfflineMap.lookup(self.OfflineGeoData, data.profile, data.preferred);
    self.postMessage({ result, land: data.includeLand ? self.OfflineGeoData.land : undefined });
  } catch (error) {
    self.postMessage({ error: error.message || "本地地图文件未加载，请重试" });
  }
};

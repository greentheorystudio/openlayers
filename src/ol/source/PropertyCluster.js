/**
 * @module ol/source/PropertyCluster
 */

import {getUid} from '../util.js';
import {assert} from '../asserts.js';
import Feature from '../Feature.js';
import {scale as scaleCoordinate, add as addCoordinate} from '../coordinate.js';
import EventType from '../events/EventType.js';
import {buffer, createEmpty, createOrUpdateFromCoordinate} from '../extent.js';
import Point from '../geom/Point.js';
import VectorSource from './Vector.js';

/**
 * @typedef {Object} Options
 * @property {import("./Source.js").AttributionLike} [attributions] Attributions.
 * @property {number} [distance=20] Minimum distance in pixels between clusters.
 * @property {string} [clusterkey=''] Field to which points are clustered.
 * @property {string} [indexkey=''] Id attribute of elements to be clustered.
 * @property {function(Feature):Point} [geometryFunction]
 * Function that takes an {@link module:ol/Feature} as argument and returns an
 * {@link module:ol/geom/Point} as cluster calculation point for the feature. When a
 * feature should not be considered for clustering, the function should return
 * `null`. The default, which works when the underyling source contains point
 * features only, is
 * ```js
 * function(feature) {
 *   return feature.getGeometry();
 * }
 * ```
 * See {@link module:ol/geom/Polygon~Polygon#getInteriorPoint} for a way to get a cluster
 * calculation point for polygons.
 * @property {VectorSource} source Source.
 * @property {boolean} [wrapX=true] Whether to wrap the world horizontally.
 */


/**
 * @classdesc
 * Layer source to cluster vector data. Works out of the box with point
 * geometries. For other geometry types, or if not all geometries should be
 * considered for clustering, a custom `geometryFunction` can be defined.
 * @api
 */
class PropertyCluster extends VectorSource {
  /**
   * @param {Options} options PropertyCluster options.
   */
  constructor(options) {
    super({
      attributions: options.attributions,
      wrapX: options.wrapX
    });

    /**
     * @type {number|undefined}
     * @protected
     */
    this.resolution = undefined;

    /**
     * @type {number}
     * @protected
     */
    this.distance = options.distance !== undefined ? options.distance : 20;

    /**
     * @type {string}
     * @protected
     */
    this.clusterkey = options.clusterkey !== undefined ? options.clusterkey : '';

    /**
     * @type {string}
     * @protected
     */
    this.indexkey = options.indexkey !== undefined ? options.indexkey : '';

    /**
     * @type {Array<Feature>}
     * @protected
     */
    this.features = [];

    /**
     * @param {Feature} feature Feature.
     * @return {Point} Cluster calculation point.
     * @protected
     */
    this.geometryFunction = options.geometryFunction || function(feature) {
      const geometry = feature.getGeometry();
      assert(geometry instanceof Point,
        10); // The default `geometryFunction` can only handle `Point` geometries
      return geometry;
    };

    /**
     * @type {VectorSource}
     * @protected
     */
    this.source = options.source;

    this.source.addEventListener(EventType.CHANGE, this.refresh.bind(this));
  }

  /**
   * Get the distance in pixels between clusters.
   * @return {number} Distance.
   * @api
   */
  getDistance() {
    return this.distance;
  }

  /**
   * Get the field to which points are clustered.
   * @return {string} Clusterkey.
   * @api
   */
  getClusterkey() {
    return this.clusterkey;
  }

  /**
   * Get the id attribute of elements to be clustered.
   * @return {string} Indexkey.
   * @api
   */
  getIndexkey() {
    return this.indexkey;
  }

  /**
   * Get a reference to the wrapped source.
   * @return {VectorSource} Source.
   * @api
   */
  getSource() {
    return this.source;
  }

  /**
   * @inheritDoc
   */
  loadFeatures(extent, resolution, projection) {
    this.source.loadFeatures(extent, resolution, projection);
    if (resolution !== this.resolution) {
      this.clear();
      this.resolution = resolution;
      this.cluster();
      this.addFeatures(this.features);
    }
  }

  /**
   * Set the distance in pixels between clusters.
   * @param {number} distance The distance in pixels.
   * @api
   */
  setDistance(distance) {
    this.distance = distance;
    this.refresh();
  }

  /**
   * Set the field to which points are clustered.
   * @param {string} clusterkey The field name.
   * @api
   */
  setClusterkey(clusterkey) {
    this.clusterkey = clusterkey;
    this.refresh();
  }

  /**
   * Set the id attribute of elements to be clustered.
   * @param {string} indexkey The field name.
   * @api
   */
  setIndexkey(indexkey) {
    this.indexkey = indexkey;
    this.refresh();
  }

  /**
   * handle the source changing
   * @override
   */
  refresh() {
    this.clear();
    this.cluster();
    this.addFeatures(this.features);
  }

  /**
   * @protected
   */
  cluster() {
    if (this.resolution === undefined) {
      return;
    }
    this.features.length = 0;
    const extent = createEmpty();
    const mapDistance = this.distance * this.resolution;
    const features = this.source.getFeatures();

    /**
     * @type {!Object<string, boolean>}
     */
    const clustered = {};

    for (let i = 0, ii = features.length; i < ii; i++) {
      const feature = features[i];
      if (!(getUid(feature) in clustered)) {
        const geometry = this.geometryFunction(feature);
        if (geometry) {
          const cKey = feature.get(this.clusterkey);
          const coordinates = geometry.getCoordinates();
          createOrUpdateFromCoordinate(coordinates, extent);
          buffer(extent, mapDistance, extent);

          let neighbors = this.source.getFeaturesInExtent(extent);

          const realNeighbors = [];
          for (const i in neighbors) {
            if (neighbors.hasOwnProperty(i)) {
              const nfeature = neighbors[i];
              const nKey = nfeature.get(this.clusterkey);
              if (nKey === cKey) {
                realNeighbors.push(nfeature);
              }
            }
          }

          neighbors = realNeighbors.filter(function(neighbor) {
            const uid = getUid(neighbor);
            if (!(uid in clustered)) {
              clustered[uid] = true;
              return true;
            } else {
              return false;
            }
          });
          this.features.push(this.createCluster(cKey, neighbors));
        }
      }
    }
  }

  /**
   * @param {string} cKey ClusterKey
   * @param {Array<Feature>} features Features
   * @return {Feature} The cluster feature.
   * @protected
   */
  createCluster(cKey, features) {
    const centroid = [0, 0];
    const indexVals = [];
    for (let i = features.length - 1; i >= 0; --i) {
      const geometry = this.geometryFunction(features[i]);
      const iVal = Number(features[i].get(this.indexkey));
      indexVals.push(iVal);
      if (geometry) {
        addCoordinate(centroid, geometry.getCoordinates());
      } else {
        features.splice(i, 1);
      }
    }
    scaleCoordinate(centroid, 1 / features.length);

    const cluster = new Feature(new Point(centroid));
    cluster.set('features', features);
    cluster.set('clusterkey', cKey);
    cluster.set('identifiers', indexVals);
    return cluster;
  }
}


export default PropertyCluster;

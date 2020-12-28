
// RIPPLES CLASS DEFINITION
// =========================
class Ripples {
  constructor(el, options) {
    this.transparentPixels = this.createImageData(32, 32);
    const that = this;

    this.$el = el;

    // Init properties from options
    this.interactive = options.interactive;
    this.resolution = options.resolution;
    this.textureDelta = new Float32Array([1 / this.resolution, 1 / this.resolution]);

    this.perturbance = options.perturbance;
    this.dropRadius = options.dropRadius;

    this.crossOrigin = options.crossOrigin;
    this.imageUrl = options.imageUrl;

    // Init WebGL canvas
    const canvas = document.createElement('canvas');
    canvas.width = this.$el.clientWidth;
    canvas.height = this.$el.clientHeight;
    this.canvas = canvas;
    this.canvas.style.position = 'absolute';
    this.canvas.style.left = 0;
    this.canvas.style.top = 0;
    this.canvas.style.right = 0;
    this.canvas.style.bottom = 0;
    this.canvas.style.zIndex = -1;

    this.$el.classList.add('javascript-ripples');
    this.$el.append(canvas);
    this.context = Ripples.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

    // Load extensions
    Ripples.config.extensions.forEach(function (name) {
      Ripples.gl.getExtension(name);
    });

    // Auto-resize when window size changes.
    window.addEventListener('resize', (e) => this.constructor.updateSize.apply(this, e));

    // Init rendertargets for ripple data.
    this.textures = [];
    this.framebuffers = [];
    this.bufferWriteIndex = 0;
    this.bufferReadIndex = 1;

    const arrayType = Ripples.config.arrayType;
    const textureData = arrayType ? new arrayType(this.resolution * this.resolution * 4) : null;

    for (let i = 0; i < 2; i++) {
      const texture = Ripples.gl.createTexture();
      const framebuffer = Ripples.gl.createFramebuffer();

      Ripples.gl.bindFramebuffer(Ripples.gl.FRAMEBUFFER, framebuffer);

      Ripples.gl.bindTexture(Ripples.gl.TEXTURE_2D, texture);
      Ripples.gl.texParameteri(Ripples.gl.TEXTURE_2D, Ripples.gl.TEXTURE_MIN_FILTER, Ripples.config.linearSupport ? Ripples.gl.LINEAR : Ripples.gl.NEAREST);
      Ripples.gl.texParameteri(Ripples.gl.TEXTURE_2D, Ripples.gl.TEXTURE_MAG_FILTER, Ripples.config.linearSupport ? Ripples.gl.LINEAR : Ripples.gl.NEAREST);
      Ripples.gl.texParameteri(Ripples.gl.TEXTURE_2D, Ripples.gl.TEXTURE_WRAP_S, Ripples.gl.CLAMP_TO_EDGE);
      Ripples.gl.texParameteri(Ripples.gl.TEXTURE_2D, Ripples.gl.TEXTURE_WRAP_T, Ripples.gl.CLAMP_TO_EDGE);
      Ripples.gl.texImage2D(Ripples.gl.TEXTURE_2D, 0, Ripples.gl.RGBA, this.resolution, this.resolution, 0, Ripples.gl.RGBA, Ripples.config.type, textureData);

      Ripples.gl.framebufferTexture2D(Ripples.gl.FRAMEBUFFER, Ripples.gl.COLOR_ATTACHMENT0, Ripples.gl.TEXTURE_2D, texture, 0);

      this.textures.push(texture);
      this.framebuffers.push(framebuffer);
    }

    // Init GL stuff
    this.quad = Ripples.gl.createBuffer();
    Ripples.gl.bindBuffer(Ripples.gl.ARRAY_BUFFER, this.quad);
    Ripples.gl.bufferData(Ripples.gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
      +1, -1,
      +1, +1,
      -1, +1
    ]), Ripples.gl.STATIC_DRAW);

    this.initShaders();
    this.initTexture();
    this.setTransparentTexture();

    // Load the image either from the options or CSS rules
    this.loadImage();

    // Set correct clear color and blend mode (regular alpha blending)
    Ripples.gl.clearColor(0, 0, 0, 0);
    Ripples.gl.blendFunc(Ripples.gl.SRC_ALPHA, Ripples.gl.ONE_MINUS_SRC_ALPHA);

    // Plugin is successfully initialized!
    this.visible = true;
    this.running = true;
    this.inited = true;
    this.destroyed = false;

    this.setupPointerEvents();

    // Init animation
    function step() {
      if (!that.destroyed) {
        that.step();

        requestAnimationFrame(step);
      }
    }

    requestAnimationFrame(step);

    // Extend the css
    this.style = document.createElement('style');
    this.style.innerText = '.javascript-ripples { position: relative; z-index: 0; }';
    document.querySelector('head').prepend(this.style);
  }

  static gl

  isPercentage(str) {
    return str[str.length - 1] === '%';
  }

  /**
   *  Load a configuration of GL settings which the browser supports.
   *  For example:
   *  - not all browsers support WebGL
   *  - not all browsers support floating point textures
   *  - not all browsers support linear filtering for floating point textures
   *  - not all browsers support rendering to floating point textures
   *  - some browsers *do* support rendering to half-floating point textures instead.
   */
  static loadConfig() {
    const canvas = document.createElement('canvas');
    Ripples.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

    if (!Ripples.gl) {
      // Browser does not support WebGL.
      return null;
    }

    // Load extensions
    const extensions = {};
    [
      'OES_texture_float',
      'OES_texture_half_float',
      'OES_texture_float_linear',
      'OES_texture_half_float_linear'
    ].forEach(function (name) {
      const extension = Ripples.gl.getExtension(name);
      if (extension) {
        extensions[name] = extension;
      }
    });

    // If no floating point extensions are supported we can bail out early.
    if (!extensions.OES_texture_float) {
      return null;
    }

    const configs = [];

    function createConfig(type, glType, arrayType) {
      const name = 'OES_texture_' + type,
        nameLinear = name + '_linear',
        linearSupport = nameLinear in extensions,
        configExtensions = [name];
      if (linearSupport) {
        configExtensions.push(nameLinear);
      }

      return {
        type: glType,
        arrayType: arrayType,
        linearSupport: linearSupport,
        extensions: configExtensions
      };
    }

    configs.push(
      createConfig('float', Ripples.gl.FLOAT, Float32Array)
    );

    if (extensions.OES_texture_half_float) {
      configs.push(
        // Array type should be Uint16Array, but at least on iOS that breaks. In that case we
        // just initialize the textures with data=null, instead of data=new Uint16Array(...).
        // This makes initialization a tad slower, but it's still negligible.
        createConfig('half_float', extensions.OES_texture_half_float.HALF_FLOAT_OES, null)
      );
    }

    // Setup the texture and framebuffer
    const texture = Ripples.gl.createTexture();
    const framebuffer = Ripples.gl.createFramebuffer();

    Ripples.gl.bindFramebuffer(Ripples.gl.FRAMEBUFFER, framebuffer);
    Ripples.gl.bindTexture(Ripples.gl.TEXTURE_2D, texture);
    Ripples.gl.texParameteri(Ripples.gl.TEXTURE_2D, Ripples.gl.TEXTURE_MIN_FILTER, Ripples.gl.NEAREST);
    Ripples.gl.texParameteri(Ripples.gl.TEXTURE_2D, Ripples.gl.TEXTURE_MAG_FILTER, Ripples.gl.NEAREST);
    Ripples.gl.texParameteri(Ripples.gl.TEXTURE_2D, Ripples.gl.TEXTURE_WRAP_S, Ripples.gl.CLAMP_TO_EDGE);
    Ripples.gl.texParameteri(Ripples.gl.TEXTURE_2D, Ripples.gl.TEXTURE_WRAP_T, Ripples.gl.CLAMP_TO_EDGE);

    // Check for each supported texture type if rendering to it is supported
    let config = null;

    for (let i = 0; i < configs.length; i++) {
      Ripples.gl.texImage2D(Ripples.gl.TEXTURE_2D, 0, Ripples.gl.RGBA, 32, 32, 0, Ripples.gl.RGBA, configs[i].type, null);

      Ripples.gl.framebufferTexture2D(Ripples.gl.FRAMEBUFFER, Ripples.gl.COLOR_ATTACHMENT0, Ripples.gl.TEXTURE_2D, texture, 0);
      if (Ripples.gl.checkFramebufferStatus(Ripples.gl.FRAMEBUFFER) === Ripples.gl.FRAMEBUFFER_COMPLETE) {
        config = configs[i];
        break;
      }
    }

    return config;
  }

  createImageData(width, height) {
    try {
      return new ImageData(width, height);
    }
    catch (e) {
      // Fallback for IE
      const canvas = document.createElement('canvas');
      return canvas.getContext('2d').createImageData(width, height);
    }
  }

  translateBackgroundPosition(value) {
    const parts = value.split(' ');

    if (parts.length === 1) {
      switch (value) {
        case 'center':
          return ['50%', '50%'];
        case 'top':
          return ['50%', '0'];
        case 'bottom':
          return ['50%', '100%'];
        case 'left':
          return ['0', '50%'];
        case 'right':
          return ['100%', '50%'];
        default:
          return [value, '50%'];
      }
    }
    else {
      return parts.map(function (part) {
        switch (value) {
          case 'center':
            return '50%';
          case 'top':
          case 'left':
            return '0';
          case 'right':
          case 'bottom':
            return '100%';
          default:
            return part;
        }
      });
    }
  }

  createProgram(vertexSource, fragmentSource, uniformValues) {
    function compileSource(type, source) {
      const shader = Ripples.gl.createShader(type);
      Ripples.gl.shaderSource(shader, source);
      Ripples.gl.compileShader(shader);
      if (!Ripples.gl.getShaderParameter(shader, Ripples.gl.COMPILE_STATUS)) {
        throw new Error('compile error: ' + Ripples.gl.getShaderInfoLog(shader));
      }
      return shader;
    }

    const program = {};

    program.id = Ripples.gl.createProgram();
    Ripples.gl.attachShader(program.id, compileSource(Ripples.gl.VERTEX_SHADER, vertexSource));
    Ripples.gl.attachShader(program.id, compileSource(Ripples.gl.FRAGMENT_SHADER, fragmentSource));
    Ripples.gl.linkProgram(program.id);
    if (!Ripples.gl.getProgramParameter(program.id, Ripples.gl.LINK_STATUS)) {
      throw new Error('link error: ' + Ripples.gl.getProgramInfoLog(program.id));
    }

    // Fetch the uniform and attribute locations
    program.uniforms = {};
    program.locations = {};
    Ripples.gl.useProgram(program.id);
    Ripples.gl.enableVertexAttribArray(0);
    let match, name;
    const regex = /uniform (\w+) (\w+)/g, shaderCode = vertexSource + fragmentSource;
    while ((match = regex.exec(shaderCode)) != null) {
      name = match[2];
      program.locations[name] = Ripples.gl.getUniformLocation(program.id, name);
    }

    return program;
  }

  bindTexture(texture, unit) {
    Ripples.gl.activeTexture(Ripples.gl.TEXTURE0 + (unit || 0));
    Ripples.gl.bindTexture(Ripples.gl.TEXTURE_2D, texture);
  }

  extractUrl(value) {
    const urlMatch = /url\(["']?([^"']*)["']?\)/.exec(value);
    if (urlMatch == null) {
      return null;
    }

    return urlMatch[1];
  }

  isDataUri(url) {
    return url.match(/^data:/);
  }

  static DEFAULTS = {
    imageUrl: null,
    resolution: 256,
    dropRadius: 20,
    perturbance: 0.03,
    interactive: true,
    crossOrigin: ''
  };

  setupPointerEvents() {
    const that = this;

    function pointerEventsEnabled() {
      return that.visible && that.running && that.interactive;
    }

    function dropAtPointer(pointer, big) {
      if (pointerEventsEnabled()) {
        that.dropAtPointer(
          pointer,
          that.dropRadius * (big ? 1.5 : 1),
          (big ? 0.14 : 0.01)
        );
      }
    }

    // Start listening to pointer events
    this.$el.addEventListener('mousemove', (e) => {
      dropAtPointer(e);
    });

    this.$el.addEventListener('touchmove', (e) => {
      const touches = e.originalEvent.changedTouches;
      for (let i = 0; i < touches.length; i++) {
        dropAtPointer(touches[i]);
      }
    });

    this.$el.addEventListener('touchstart', (e) => {
      const touches = e.originalEvent.changedTouches;
      for (let i = 0; i < touches.length; i++) {
        dropAtPointer(touches[i]);
      }
    });

    this.$el.addEventListener('mousedown', (e) => {
      dropAtPointer(e, true);
    });
  }

  // Load the image either from the options or the element's CSS rules.
  loadImage() {
    const that = this;

    Ripples.gl = this.context;
    let $elStyle;
    try {
      $elStyle = window.getComputedStyle(this.$el);
    } catch (error) {
      $elStyle = this.$el.style;
    }
    const newImageSource = this.imageUrl ||
      this.extractUrl(this.originalCssBackgroundImage) ||
      this.extractUrl($elStyle.backgroundImage);

    // If image source is unchanged, don't reload it.
    if (newImageSource == this.imageSource) {
      return;
    }

    this.imageSource = newImageSource;

    // Falsy source means no background.
    if (!this.imageSource) {
      this.setTransparentTexture();
      return;
    }

    // Load the texture from a new image.
    const image = new Image;
    image.onload = function () {
      Ripples.gl = that.context;

      // Only textures with dimensions of powers of two can have repeat wrapping.
      function isPowerOfTwo(x) {
        return (x & (x - 1)) == 0;
      }

      const wrapping = (isPowerOfTwo(image.width) && isPowerOfTwo(image.height)) ? Ripples.gl.REPEAT : Ripples.gl.CLAMP_TO_EDGE;

      Ripples.gl.bindTexture(Ripples.gl.TEXTURE_2D, that.backgroundTexture);
      Ripples.gl.texParameteri(Ripples.gl.TEXTURE_2D, Ripples.gl.TEXTURE_WRAP_S, wrapping);
      Ripples.gl.texParameteri(Ripples.gl.TEXTURE_2D, Ripples.gl.TEXTURE_WRAP_T, wrapping);
      Ripples.gl.texImage2D(Ripples.gl.TEXTURE_2D, 0, Ripples.gl.RGBA, Ripples.gl.RGBA, Ripples.gl.UNSIGNED_BYTE, image);

      that.backgroundWidth = image.width;
      that.backgroundHeight = image.height;

      // Hide the background that we're replacing.
      that.hideCssBackground();
    };

    // Fall back to a transparent texture when loading the image failed.
    image.onerror = function () {
      Ripples.gl = that.context;

      that.setTransparentTexture();
    };

    // Disable CORS when the image source is a data URI.
    image.crossOrigin = this.isDataUri(this.imageSource) ? null : this.crossOrigin;

    image.src = this.imageSource;
  }

  step() {
    Ripples.gl = this.context;

    if (!this.visible) {
      return;
    }

    this.computeTextureBoundaries();

    if (this.running) {
      this.update();
    }

    this.render();
  }

  drawQuad() {
    Ripples.gl.bindBuffer(Ripples.gl.ARRAY_BUFFER, this.quad);
    Ripples.gl.vertexAttribPointer(0, 2, Ripples.gl.FLOAT, false, 0, 0);
    Ripples.gl.drawArrays(Ripples.gl.TRIANGLE_FAN, 0, 4);
  }

  render() {
    Ripples.gl.bindFramebuffer(Ripples.gl.FRAMEBUFFER, null);

    Ripples.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    Ripples.gl.enable(Ripples.gl.BLEND);
    Ripples.gl.clear(Ripples.gl.COLOR_BUFFER_BIT | Ripples.gl.DEPTH_BUFFER_BIT);

    Ripples.gl.useProgram(this.renderProgram.id);

    this.bindTexture(this.backgroundTexture, 0);
    this.bindTexture(this.textures[0], 1);

    Ripples.gl.uniform1f(this.renderProgram.locations.perturbance, this.perturbance);
    Ripples.gl.uniform2fv(this.renderProgram.locations.topLeft, this.renderProgram.uniforms.topLeft);
    Ripples.gl.uniform2fv(this.renderProgram.locations.bottomRight, this.renderProgram.uniforms.bottomRight);
    Ripples.gl.uniform2fv(this.renderProgram.locations.containerRatio, this.renderProgram.uniforms.containerRatio);
    Ripples.gl.uniform1i(this.renderProgram.locations.samplerBackground, 0);
    Ripples.gl.uniform1i(this.renderProgram.locations.samplerRipples, 1);

    this.drawQuad();
    Ripples.gl.disable(Ripples.gl.BLEND);
  }

  update() {
    Ripples.gl.viewport(0, 0, this.resolution, this.resolution);

    Ripples.gl.bindFramebuffer(Ripples.gl.FRAMEBUFFER, this.framebuffers[this.bufferWriteIndex]);
    this.bindTexture(this.textures[this.bufferReadIndex]);
    Ripples.gl.useProgram(this.updateProgram.id);

    this.drawQuad();

    this.swapBufferIndices();
  }

  swapBufferIndices() {
    this.bufferWriteIndex = 1 - this.bufferWriteIndex;
    this.bufferReadIndex = 1 - this.bufferReadIndex;
  }

  computeTextureBoundaries() {
    let $elStyle;
    try {
      $elStyle = window.getComputedStyle(this.$el);
    } catch (error) {
      $elStyle = this.$el.style;
    }
    let backgroundSize = $elStyle.backgroundSize;
    const backgroundAttachment = $elStyle.backgroundAttachment;
    const backgroundPosition = this.translateBackgroundPosition($elStyle.backgroundPosition);

    // Here the 'container' is the element which the background adapts to
    // (either the chrome window or some element, depending on attachment)
    let container;
    if (backgroundAttachment === 'fixed') {
      container = { left: window.pageXOffset, top: window.pageYOffset };
      container.width = window.innerWidth;
      container.height = window.innerHeight;
    }
    else {
      container = { top: this.$el.offsetTop, left: this.$el.offsetLeft };
      container.width = this.$el.clientWidth;
      container.height = this.$el.clientHeight;
    }

    // TODO: background-clip
    let backgroundWidth;
    let backgroundHeight;

    if (backgroundSize == 'cover') {
      const scale = Math.max(container.width / this.backgroundWidth, container.height / this.backgroundHeight);

      backgroundWidth = this.backgroundWidth * scale;
      backgroundHeight = this.backgroundHeight * scale;
    }
    else if (backgroundSize == 'contain') {
      const scale = Math.min(container.width / this.backgroundWidth, container.height / this.backgroundHeight);

      backgroundWidth = this.backgroundWidth * scale;
      backgroundHeight = this.backgroundHeight * scale;
    }
    else {
      backgroundSize = backgroundSize.split(' ');
      backgroundWidth = backgroundSize[0] || '';
      backgroundHeight = backgroundSize[1] || backgroundWidth;

      if (this.isPercentage(backgroundWidth)) {
        backgroundWidth = container.width * parseFloat(backgroundWidth) / 100;
      }
      else if (backgroundWidth != 'auto') {
        backgroundWidth = parseFloat(backgroundWidth);
      }

      if (this.isPercentage(backgroundHeight)) {
        backgroundHeight = container.height * parseFloat(backgroundHeight) / 100;
      }
      else if (backgroundHeight != 'auto') {
        backgroundHeight = parseFloat(backgroundHeight);
      }

      if (backgroundWidth == 'auto' && backgroundHeight == 'auto') {
        backgroundWidth = this.backgroundWidth;
        backgroundHeight = this.backgroundHeight;
      }
      else {
        if (backgroundWidth == 'auto') {
          backgroundWidth = this.backgroundWidth * (backgroundHeight / this.backgroundHeight);
        }

        if (backgroundHeight == 'auto') {
          backgroundHeight = this.backgroundHeight * (backgroundWidth / this.backgroundWidth);
        }
      }
    }

    // Compute backgroundX and backgroundY in page coordinates
    let backgroundX = backgroundPosition[0];
    let backgroundY = backgroundPosition[1];

    if (this.isPercentage(backgroundX)) {
      backgroundX = container.left + (container.width - backgroundWidth) * parseFloat(backgroundX) / 100;
    }
    else {
      backgroundX = container.left + parseFloat(backgroundX);
    }

    if (this.isPercentage(backgroundY)) {
      backgroundY = container.top + (container.height - backgroundHeight) * parseFloat(backgroundY) / 100;
    }
    else {
      backgroundY = container.top + parseFloat(backgroundY);
    }

    const elementOffset = { top: this.$el.offsetTop, left: this.$el.offsetLeft };

    this.renderProgram.uniforms.topLeft = new Float32Array([
      (elementOffset.left - backgroundX) / backgroundWidth,
      (elementOffset.top - backgroundY) / backgroundHeight
    ]);
    this.renderProgram.uniforms.bottomRight = new Float32Array([
      this.renderProgram.uniforms.topLeft[0] + this.$el.clientWidth / backgroundWidth,
      this.renderProgram.uniforms.topLeft[1] + this.$el.clientHeight / backgroundHeight
    ]);

    const maxSide = Math.max(this.canvas.width, this.canvas.height);

    this.renderProgram.uniforms.containerRatio = new Float32Array([
      this.canvas.width / maxSide,
      this.canvas.height / maxSide
    ]);
  }

  initShaders() {
    const vertexShader = `
      attribute vec2 vertex;
      varying vec2 coord;
      void main() {
        coord = vertex * 0.5 + 0.5;
        gl_Position = vec4(vertex, 0.0, 1.0);
      }
    `;

    this.dropProgram = this.createProgram(vertexShader,
      `precision highp float;

      const float PI = 3.141592653589793;
      uniform sampler2D texture;
      uniform vec2 center;
      uniform float radius;
      uniform float strength;

      varying vec2 coord;

      void main() {
        vec4 info = texture2D(texture, coord);

        float drop = max(0.0, 1.0 - length(center * 0.5 + 0.5 - coord) / radius);
        drop = 0.5 - cos(drop * PI) * 0.5;

        info.r += drop * strength;

        gl_FragColor = info;
      }`
    );

    this.updateProgram = this.createProgram(vertexShader,
      `precision highp float;

      uniform sampler2D texture;
      uniform vec2 delta;

      varying vec2 coord;

      void main() {
        vec4 info = texture2D(texture, coord);

        vec2 dx = vec2(delta.x, 0.0);
        vec2 dy = vec2(0.0, delta.y);

        float average = (
          texture2D(texture, coord - dx).r +
          texture2D(texture, coord - dy).r +
          texture2D(texture, coord + dx).r +
          texture2D(texture, coord + dy).r
        ) * 0.25;

        info.g += (average - info.r) * 2.0;
        info.g *= 0.995;
        info.r += info.g;

        gl_FragColor = info;
      }`
    );
    Ripples.gl.uniform2fv(this.updateProgram.locations.delta, this.textureDelta);

    this.renderProgram = this.createProgram(
      `precision highp float;

      attribute vec2 vertex;
      uniform vec2 topLeft;
      uniform vec2 bottomRight;
      uniform vec2 containerRatio;
      varying vec2 ripplesCoord;
      varying vec2 backgroundCoord;
      void main() {
        backgroundCoord = mix(topLeft, bottomRight, vertex * 0.5 + 0.5);
        backgroundCoord.y = 1.0 - backgroundCoord.y;
        ripplesCoord = vec2(vertex.x, -vertex.y) * containerRatio * 0.5 + 0.5;
        gl_Position = vec4(vertex.x, -vertex.y, 0.0, 1.0);
      }`,
      `precision highp float;

      uniform sampler2D samplerBackground;
      uniform sampler2D samplerRipples;
      uniform vec2 delta;

      uniform float perturbance;
      varying vec2 ripplesCoord;
      varying vec2 backgroundCoord;

      void main() {
        float height = texture2D(samplerRipples, ripplesCoord).r;
        float heightX = texture2D(samplerRipples, vec2(ripplesCoord.x + delta.x, ripplesCoord.y)).r;
        float heightY = texture2D(samplerRipples, vec2(ripplesCoord.x, ripplesCoord.y + delta.y)).r;
        vec3 dx = vec3(delta.x, heightX - height, 0.0);
        vec3 dy = vec3(0.0, heightY - height, delta.y);
        vec2 offset = -normalize(cross(dy, dx)).xz;
        float specular = pow(max(0.0, dot(offset, normalize(vec2(-0.6, 1.0)))), 4.0);
        gl_FragColor = texture2D(samplerBackground, backgroundCoord + offset * perturbance) + specular;
      }`
    );
    Ripples.gl.uniform2fv(this.renderProgram.locations.delta, this.textureDelta);
  }

  initTexture() {
    this.backgroundTexture = Ripples.gl.createTexture();
    Ripples.gl.bindTexture(Ripples.gl.TEXTURE_2D, this.backgroundTexture);
    Ripples.gl.pixelStorei(Ripples.gl.UNPACK_FLIP_Y_WEBGL, 1);
    Ripples.gl.texParameteri(Ripples.gl.TEXTURE_2D, Ripples.gl.TEXTURE_MAG_FILTER, Ripples.gl.LINEAR);
    Ripples.gl.texParameteri(Ripples.gl.TEXTURE_2D, Ripples.gl.TEXTURE_MIN_FILTER, Ripples.gl.LINEAR);
  }

  setTransparentTexture() {
    Ripples.gl.bindTexture(Ripples.gl.TEXTURE_2D, this.backgroundTexture);
    Ripples.gl.texImage2D(Ripples.gl.TEXTURE_2D, 0, Ripples.gl.RGBA, Ripples.gl.RGBA, Ripples.gl.UNSIGNED_BYTE, this.transparentPixels);
  }

  hideCssBackground() {

    // Check whether we're changing inline CSS or overriding a global CSS rule.
    let $elStyle;
    try {
      $elStyle = window.getComputedStyle(this.$el);
    } catch (error) {
      $elStyle = this.$el.style;
    }
    const inlineCss = $elStyle.backgroundImage;

    if (inlineCss == 'none') {
      return;
    }

    this.originalInlineCss = inlineCss;

    this.originalCssBackgroundImage = this.style.backgroundImage;
    this.$el.style.backgroundImage = 'none';
  }

  restoreCssBackground() {

    // Restore background by either changing the inline CSS rule to what it was, or
    // simply remove the inline CSS rule if it never was inlined.
    this.$el.style.backgroundImage = this.originalInlineCss || '';
  }

  dropAtPointer(pointer, radius, strength) {
    let $elStyle;
    try {
      $elStyle = window.getComputedStyle(this.$el);
    } catch (error) {
      $elStyle = this.$el.style;
    }
    const borderLeft = parseInt($elStyle.borderLeftWidth) || 0,
      borderTop = parseInt($elStyle.borderTopWidth) || 0;
    this.constructor.drop.apply(this,
      [pointer.pageX - this.$el.offsetLeft - borderLeft,
      pointer.pageY - this.$el.offsetTop - borderTop,
        radius,
        strength]);
  }

  /**
   *  Public methods
   */
  static drop(x, y, radius, strength) {
    Ripples.gl = this.context;

    const elWidth = this.$el.getBoundingClientRect().width;
    const elHeight = this.$el.getBoundingClientRect().height;
    const longestSide = Math.max(elWidth, elHeight);

    radius = radius / longestSide;

    const dropPosition = new Float32Array([
      (2 * x - elWidth) / longestSide,
      (elHeight - 2 * y) / longestSide
    ]);

    Ripples.gl.viewport(0, 0, this.resolution, this.resolution); // 設置畫布的起始座標與寬高

    Ripples.gl.bindFramebuffer(Ripples.gl.FRAMEBUFFER, this.framebuffers[this.bufferWriteIndex]);
    this.bindTexture(this.textures[this.bufferReadIndex]);

    Ripples.gl.useProgram(this.dropProgram.id);
    Ripples.gl.uniform2fv(this.dropProgram.locations.center, dropPosition);
    Ripples.gl.uniform1f(this.dropProgram.locations.radius, radius);
    Ripples.gl.uniform1f(this.dropProgram.locations.strength, strength);

    this.drawQuad();

    this.swapBufferIndices();
  }

  static updateSize() {
    const newWidth = this.$el.getBoundingClientRect().width,
      newHeight = this.$el.getBoundingClientRect().height;

    if (newWidth != this.canvas.width || newHeight != this.canvas.height) {
      this.canvas.width = newWidth;
      this.canvas.height = newHeight;
    }
  }

  static destroy() {
    this.$el.removeEventListener('mousemove', this.ripplesMousemove);
    this.$el.removeEventListener('touchmove', this.ripplesTouchmove);
    this.$el.removeEventListener('touchstart', this.ripplesTouchstart);
    this.$el.removeEventListener('mousedown', this.ripplesMousedown);
    this.$el.classList.remove('javascript-ripples');
    this.$el.ripples = undefined;

    // Make sure the last used context is garbage-collected
    Ripples.gl = null;

    window.removeEventListener('resize', (e) => this.constructor.updateSize.apply(this, e));

    this.canvas.remove();
    this.restoreCssBackground();

    this.destroyed = true;
  }

  static show() {
    this.visible = true;

    this.canvas.style.dispaly = '';
    this.hideCssBackground();
  }

  static hide() {
    this.visible = false;

    this.canvas.style.dispaly = 'none';
    this.restoreCssBackground();
  }

  static pause() {
    this.running = false;
  }

  static play() {
    this.running = true;
  }

  static set(property, value) {
    switch (property) {
      case 'dropRadius':
      case 'perturbance':
      case 'interactive':
      case 'crossOrigin':
        this[property] = value;
        break;
      case 'imageUrl':
        this.imageUrl = value;
        this.loadImage();
        break;
    }
  }

  static config

  static ripples(targetId, option) {
    const args = Array.prototype.slice.call(arguments, Ripples.ripples.length);
    if (!Ripples.config) {
      throw new Error('Your browser does not support WebGL, the OES_texture_float extension or rendering to floating point textures.');
    }

    const target = document.querySelector(targetId);

    const data = target.ripples,
      options = { ...Ripples.DEFAULTS, ripples: target.ripples, ...(typeof option == 'object' ? option : {}) };

    if (!data && typeof option == 'string') {
      return;
    }

    if (!data) {
      target.ripples = new Ripples(target, options);
    } else if (typeof option == 'string') {
      Ripples[option].apply(data, args);
    }
  }
}

Ripples.config = Ripples.loadConfig();
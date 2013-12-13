module.exports = function(grunt) {
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    jasmine: {
      freedom: {
        src: ['src/libs/*.js', 'src/*.js', 'src/proxy/*.js', 'interface/*.js'],
        options: {
          specs: ['spec/*Spec.js', 'spec/providers/*Spec.js']
        }
      }
    },
    jshint: {
      beforeconcat: [
          'src/libs/*.js',
          'src/*.js',
          'src/proxy/*.js',
          'providers/*.js',
          'interface/*.js',
      ],
      afterconcat: ['freedom.js'],
      files: [
          'src/libs/*.js',
          'src/*.js',
          'src/proxy/*.js',
          'providers/*.js',
          'interface/*.js',
      ],
      options: {
        '-W069': true
      }
    },
    concat: {
      dist: {
        options: {
          process: function(src) {
            return src.replace(/\/\*jslint/g,'/*');
          }
        },
        src: [
          'src/libs/*.js',
          'src/util/preamble.js',
          'src/*.js',
          'src/proxy/*.js',
          'providers/*.js',
          'interface/*.js',
          'src/util/postamble.js'
        ],
        dest: 'freedom.js'
      }
    },
    uglify: {
      options: {
        mangle: { except: ['global'] }
      },
      freedom: {
        files: {
          'freedom.min.js': ['freedom.js']
        }
      }
    },
    clean: ['freedom.js', 'freedom.min.js'],
    yuidoc: {
      compile: {
        name: '<%= pkg.name %>',
        description: '<%= pkg.description %>',
        version: '<%= pkg.version %>',
        options: {
          paths: 'src/',
          outdir: 'tools/doc/'
        }
      }
    },
    typescript: {
      base: {
        src: ['src/libs/typescript-defs/*.d.ts', 'src/libs/*.ts'],
        dest: 'src/libs',
        options: {
          module: 'amd', //or commonjs
          target: 'es5', //or es3
          // base_path: 'src/libs',
          sourcemap: true,
          fullSourceMapPath: true,
          declaration: true,
        }
      }
    }
  });

  // Load tasks.
  grunt.loadNpmTasks('grunt-contrib-jasmine');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-yuidoc');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-typescript');

  // Default tasks.
  grunt.registerTask('freedom', [
    'typescript:base',
    'jshint:beforeconcat',
    'concat',
    'jasmine',
    'jshint:afterconcat',
    'uglify'
  ]);
  grunt.registerTask('default', ['freedom']);
};

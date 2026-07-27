import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// The terminal scenes are text on flat colour — high quality costs little.
Config.setCrf(16);

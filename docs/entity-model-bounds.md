# Entity model bounds

Measurements are in blocks. Model width is the larger horizontal span; height is the static AABB height after applying each part rotation in the renderer’s `YXZ` order.

Collision reference: Java Edition values from [Minecraft Wiki: Collision / Hitbox](https://minecraft.wiki/w/Collision). This reference data and its generated comparison report use [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/), separate from the original CC0 model and texture assets. The pinned kernel API provides entity kind identifiers but no per-kind width or height. The page describes its main dimensions as primarily Java Edition and does not pin the full table to one release.

Fixed and named baseline dimensions are checked within ±10% in test/entity-model-bounds.test.ts. Varies, None, and N/A remain explicit and are not converted to invented numeric dimensions.

| Kind | Model min Y | Model width | Model height | Model X × Z | Reference width | Reference height | Reference state |
|---|---:|---:|---:|---:|---:|---:|---|
| allay | 0.000 | 0.350 | 0.600 | 0.350 × 0.180 | 0.350 | 0.600 | fixed |
| area_effect_cloud | 0.000 | 1.580 | 0.500 | 1.580 × 1.510 | Varies | 0.500 | variable: Radius varies |
| armadillo | 0.000 | 0.700 | 0.650 | 0.485 × 0.700 | 0.700 | 0.650 | baseline: Adult |
| armor_stand | 0.000 | 0.500 | 1.975 | 0.500 × 0.329 | 0.500 | 1.975 | fixed |
| arrow | 0.000 | 0.500 | 0.493 | 0.163 × 0.500 | 0.500 | 0.500 | fixed |
| axolotl | 0.000 | 0.750 | 0.420 | 0.535 × 0.750 | 0.750 | 0.420 | baseline: Adult |
| bat | 0.000 | 0.500 | 0.900 | 0.500 × 0.115 | 0.500 | 0.900 | fixed |
| bee | 0.000 | 0.700 | 0.600 | 0.608 × 0.700 | 0.700 | 0.600 | baseline: Adult |
| blaze | 0.000 | 0.600 | 1.800 | 0.600 × 0.498 | 0.600 | 1.800 | fixed |
| block_display | 0.000 | 1.020 | 0.960 | 1.020 × 0.965 | None | None | none |
| boat | 0.000 | 1.375 | 0.563 | 1.375 × 1.318 | 1.375 | 0.563 | fixed |
| bogged | 0.000 | 0.612 | 1.960 | 0.612 × 0.205 | 0.600 | 1.990 | fixed |
| breeze | 0.000 | 0.635 | 1.740 | 0.635 × 0.379 | 0.600 | 1.770 | fixed |
| breeze_wind_charge | 0.000 | 0.313 | 0.313 | 0.234 × 0.313 | 0.313 | 0.313 | fixed |
| camel | 0.000 | 1.700 | 2.580 | 1.700 × 1.364 | 1.700 | 2.375 | baseline: Normal |
| cat | 0.000 | 0.600 | 0.700 | 0.507 × 0.600 | 0.600 | 0.700 | baseline: Adult |
| cave_spider | 0.000 | 0.700 | 0.500 | 0.700 × 0.492 | 0.700 | 0.500 | fixed |
| chest_boat | 0.000 | 1.375 | 0.563 | 1.375 × 1.318 | 1.375 | 0.563 | fixed |
| chest_minecart | 0.000 | 0.980 | 0.700 | 0.980 × 0.871 | 0.980 | 0.700 | fixed |
| chicken | 0.000 | 0.400 | 0.700 | 0.342 × 0.400 | 0.400 | 0.700 | baseline: Adult |
| cod | 0.000 | 0.500 | 0.300 | 0.333 × 0.500 | 0.500 | 0.300 | fixed |
| command_block_minecart | 0.000 | 0.980 | 0.700 | 0.980 × 0.871 | 0.980 | 0.700 | fixed |
| cow | 0.000 | 0.900 | 1.400 | 0.683 × 0.900 | 0.900 | 1.400 | baseline: Adult |
| creeper | 0.000 | 0.600 | 1.700 | 0.556 × 0.600 | 0.600 | 1.700 | fixed |
| dolphin | 0.000 | 0.900 | 0.600 | 0.359 × 0.900 | 0.900 | 0.600 | baseline: Adult |
| donkey | 0.000 | 1.396 | 1.500 | 1.030 × 1.396 | 1.397 | 1.500 | baseline: Adult |
| dragon_fireball | 0.000 | 1.000 | 1.000 | 0.830 × 1.000 | 1.000 | 1.000 | fixed |
| drowned | 0.000 | 0.624 | 1.920 | 0.624 × 0.257 | 0.600 | 1.950 | baseline: Adult |
| egg | 0.000 | 0.250 | 0.250 | 0.250 × 0.250 | 0.250 | 0.250 | fixed |
| elder_guardian | 0.000 | 2.006 | 2.065 | 2.006 × 1.937 | 1.998 | 1.998 | fixed |
| end_crystal | 0.000 | 2.000 | 2.000 | 2.000 × 1.987 | 2.000 | 2.000 | fixed |
| ender_dragon | 0.000 | 16.025 | 7.981 | 16.025 × 13.441 | 16.000 | 8.000 | fixed |
| ender_pearl | 0.000 | 0.250 | 0.250 | 0.236 × 0.250 | 0.250 | 0.250 | fixed |
| enderman | 0.000 | 0.600 | 2.900 | 0.600 × 0.284 | 0.600 | 2.900 | fixed |
| endermite | 0.000 | 0.400 | 0.297 | 0.195 × 0.400 | 0.400 | 0.300 | fixed |
| evoker | 0.000 | 0.612 | 1.820 | 0.612 × 0.270 | 0.600 | 1.950 | fixed |
| evoker_fangs | 0.000 | 0.500 | 0.800 | 0.500 × 0.368 | 0.500 | 0.800 | fixed |
| experience_bottle | 0.000 | 0.250 | 0.250 | 0.250 × 0.245 | 0.250 | 0.250 | fixed |
| experience_orb | 0.000 | 0.500 | 0.500 | 0.500 × 0.385 | 0.500 | 0.500 | fixed |
| eye_of_ender | 0.000 | 0.250 | 0.250 | 0.250 × 0.155 | 0.250 | 0.250 | fixed |
| falling_block | 0.000 | 0.960 | 0.980 | 0.920 × 0.960 | 0.980 | 0.980 | fixed |
| fireball | 0.000 | 1.000 | 1.040 | 1.000 × 0.741 | 1.000 | 1.000 | fixed |
| firework_rocket | 0.000 | 0.250 | 0.250 | 0.250 × 0.158 | 0.250 | 0.250 | fixed |
| fishing_bobber | 0.000 | 0.250 | 0.250 | 0.250 × 0.250 | 0.250 | 0.250 | fixed |
| fox | 0.000 | 0.600 | 0.700 | 0.251 × 0.600 | 0.600 | 0.700 | baseline: Adult |
| frog | 0.000 | 0.500 | 0.500 | 0.500 × 0.470 | 0.500 | 0.500 | fixed |
| furnace_minecart | 0.000 | 0.980 | 0.700 | 0.980 × 0.871 | 0.980 | 0.700 | fixed |
| ghast | 0.000 | 4.000 | 4.000 | 4.000 × 3.674 | 4.000 | 4.000 | baseline: Adult |
| giant | 0.000 | 3.790 | 12.000 | 3.790 × 1.511 | 3.600 | 12.000 | fixed |
| glow_item_frame | 0.000 | 1.060 | 1.140 | 1.060 × 0.310 | N/A | N/A | unavailable |
| glow_squid | 0.000 | 0.800 | 0.800 | 0.800 × 0.563 | 0.800 | 0.800 | baseline: Adult |
| goat | 0.000 | 0.900 | 1.300 | 0.768 × 0.900 | 0.900 | 1.300 | baseline: Normal |
| guardian | 0.000 | 0.850 | 0.850 | 0.792 × 0.850 | 0.850 | 0.850 | fixed |
| hoglin | 0.000 | 1.397 | 1.396 | 0.809 × 1.397 | 1.397 | 1.400 | baseline: Adult |
| hopper_minecart | 0.000 | 0.980 | 0.700 | 0.980 × 0.871 | 0.980 | 0.700 | fixed |
| horse | 0.000 | 1.265 | 1.600 | 0.970 × 1.265 | 1.397 | 1.600 | baseline: Adult |
| husk | 0.000 | 0.626 | 1.880 | 0.626 × 0.316 | 0.600 | 1.950 | baseline: Adult |
| interaction | 0.000 | 1.530 | 1.610 | 1.530 × 0.170 | Varies | Varies | configurable |
| iron_golem | 0.000 | 1.400 | 2.550 | 1.400 × 0.566 | 1.400 | 2.700 | fixed |
| item | 0.000 | 0.250 | 0.250 | 0.250 × 0.225 | 0.250 | 0.250 | fixed |
| item_display | 0.000 | 0.760 | 1.540 | 0.760 × 0.620 | None | None | none |
| item_frame | 0.000 | 1.005 | 1.105 | 1.005 × 0.200 | N/A | N/A | unavailable |
| leash_knot | 0.000 | 0.375 | 0.500 | 0.375 × 0.085 | 0.375 | 0.500 | fixed |
| lightning_bolt | 0.000 | 1.000 | 128.000 | 1.000 × 0.338 | 1.000 | 128.000 | fixed |
| llama | 0.000 | 0.975 | 1.870 | 0.810 × 0.975 | 0.900 | 1.870 | baseline: Adult |
| llama_spit | 0.000 | 0.250 | 0.250 | 0.234 × 0.250 | 0.250 | 0.250 | fixed |
| magma_cube | 0.000 | 1.130 | 1.040 | 1.120 × 1.130 | 1.040 | 1.040 | baseline: Medium |
| marker | 0.000 | 0.720 | 1.570 | 0.720 × 0.540 | None | None | none |
| minecart | 0.000 | 0.980 | 0.700 | 0.980 × 0.871 | 0.980 | 0.700 | fixed |
| mooshroom | 0.000 | 0.900 | 1.400 | 0.900 × 0.883 | 0.900 | 1.400 | baseline: Adult |
| mule | 0.000 | 1.396 | 1.600 | 1.098 × 1.396 | 1.397 | 1.600 | baseline: Adult |
| ocelot | 0.000 | 0.600 | 0.700 | 0.454 × 0.600 | 0.600 | 0.700 | baseline: Adult |
| painting | 0.000 | 1.280 | 1.020 | 1.280 × 0.210 | N/A | N/A | unavailable |
| panda | 0.000 | 1.300 | 1.250 | 1.209 × 1.300 | 1.300 | 1.250 | baseline: Adult |
| parrot | 0.000 | 0.500 | 0.900 | 0.369 × 0.500 | 0.500 | 0.900 | fixed |
| phantom | 0.000 | 0.509 | 0.500 | 0.509 × 0.255 | 0.500 | 0.500 | fixed |
| pig | 0.000 | 0.900 | 0.900 | 0.564 × 0.900 | 0.900 | 0.900 | baseline: Adult |
| piglin | 0.000 | 0.624 | 2.130 | 0.624 × 0.391 | 0.600 | 1.950 | baseline: Adult |
| piglin_brute | 0.000 | 0.600 | 1.938 | 0.600 × 0.247 | 0.600 | 1.950 | fixed |
| pillager | 0.000 | 0.634 | 1.790 | 0.634 × 0.278 | 0.600 | 1.950 | fixed |
| player | 0.000 | 0.613 | 1.940 | 0.613 × 0.328 | 0.600 | 1.800 | baseline: Normal |
| polar_bear | 0.000 | 1.400 | 1.400 | 0.933 × 1.400 | 1.400 | 1.400 | baseline: Normal |
| potion | 0.000 | 0.250 | 0.250 | 0.250 × 0.224 | 0.250 | 0.250 | fixed |
| pufferfish | 0.000 | 0.350 | 0.350 | 0.347 × 0.350 | 0.350 | 0.350 | baseline: Unpuffed |
| rabbit | 0.000 | 0.400 | 0.500 | 0.297 × 0.400 | 0.400 | 0.500 | baseline: Adult |
| ravager | 0.000 | 1.950 | 2.191 | 1.159 × 1.950 | 1.950 | 2.200 | fixed |
| salmon | 0.000 | 0.700 | 0.400 | 0.368 × 0.700 | 0.700 | 0.400 | fixed |
| sheep | 0.000 | 0.900 | 1.300 | 0.749 × 0.900 | 0.900 | 1.300 | baseline: Adult |
| shulker | 0.000 | 0.955 | 1.022 | 0.920 × 0.955 | 1.000 | 1.000 | baseline: Closed |
| shulker_bullet | 0.000 | 0.313 | 0.313 | 0.185 × 0.313 | 0.313 | 0.313 | fixed |
| silverfish | 0.000 | 0.400 | 0.300 | 0.164 × 0.400 | 0.400 | 0.300 | fixed |
| skeleton | 0.000 | 0.612 | 1.980 | 0.612 × 0.174 | 0.600 | 1.990 | fixed |
| skeleton_horse | 0.000 | 1.397 | 1.600 | 0.941 × 1.397 | 1.397 | 1.600 | baseline: Adult |
| slime | 0.000 | 0.520 | 0.520 | 0.471 × 0.520 | 0.520 | 0.520 | baseline: Medium |
| small_fireball | 0.000 | 0.313 | 0.313 | 0.283 × 0.313 | 0.313 | 0.313 | fixed |
| sniffer | 0.000 | 1.900 | 1.750 | 0.958 × 1.900 | 1.900 | 1.750 | baseline: Adult |
| snow_golem | 0.000 | 0.700 | 1.815 | 0.700 × 0.237 | 0.700 | 1.900 | fixed |
| snowball | 0.000 | 0.250 | 0.250 | 0.228 × 0.250 | 0.250 | 0.250 | fixed |
| spawner_minecart | 0.000 | 0.980 | 0.700 | 0.980 × 0.871 | 0.980 | 0.700 | fixed |
| spectral_arrow | 0.000 | 0.500 | 0.500 | 0.121 × 0.500 | 0.500 | 0.500 | fixed |
| spider | 0.000 | 1.400 | 0.900 | 1.400 × 0.944 | 1.400 | 0.900 | fixed |
| squid | 0.000 | 0.800 | 0.800 | 0.800 × 0.575 | 0.800 | 0.800 | baseline: Adult |
| stray | 0.000 | 0.660 | 2.040 | 0.660 × 0.232 | 0.600 | 1.990 | fixed |
| strider | 0.000 | 0.900 | 1.715 | 0.755 × 0.900 | 0.900 | 1.700 | baseline: Adult |
| tadpole | 0.000 | 0.400 | 0.280 | 0.104 × 0.400 | 0.400 | 0.300 | fixed |
| text_display | 0.000 | 1.250 | 0.820 | 1.250 × 0.210 | None | None | none |
| tnt | 0.000 | 0.980 | 0.980 | 0.980 × 0.980 | 0.980 | 0.980 | fixed |
| tnt_minecart | 0.000 | 0.980 | 0.700 | 0.980 × 0.871 | 0.980 | 0.700 | fixed |
| trader_llama | 0.000 | 0.900 | 1.870 | 0.737 × 0.900 | 0.900 | 1.870 | baseline: Adult |
| trident | 0.000 | 0.500 | 0.500 | 0.500 × 0.156 | 0.500 | 0.500 | fixed |
| tropical_fish | 0.000 | 0.500 | 0.400 | 0.338 × 0.500 | 0.500 | 0.400 | fixed |
| turtle | 0.000 | 1.200 | 0.400 | 0.940 × 1.200 | 1.200 | 0.400 | baseline: Adult |
| vex | 0.000 | 0.405 | 0.785 | 0.405 × 0.066 | 0.400 | 0.800 | fixed |
| villager | 0.000 | 0.600 | 1.950 | 0.580 × 0.600 | 0.600 | 1.950 | baseline: Adult |
| vindicator | 0.000 | 0.619 | 1.800 | 0.619 × 0.240 | 0.600 | 1.950 | fixed |
| wandering_trader | 0.000 | 0.600 | 1.955 | 0.596 × 0.600 | 0.600 | 1.950 | baseline: Adult |
| warden | 0.000 | 0.928 | 2.879 | 0.928 × 0.290 | 0.900 | 2.900 | baseline: Normal |
| wind_charge | 0.000 | 0.313 | 0.313 | 0.313 × 0.313 | 0.313 | 0.313 | fixed |
| witch | 0.000 | 0.629 | 1.944 | 0.629 × 0.359 | 0.600 | 1.950 | fixed |
| wither | 0.000 | 0.900 | 3.500 | 0.900 × 0.225 | 0.900 | 3.500 | fixed |
| wither_skeleton | 0.000 | 0.734 | 2.170 | 0.734 × 0.274 | 0.700 | 2.400 | fixed |
| wither_skull | 0.000 | 0.313 | 0.313 | 0.221 × 0.313 | 0.313 | 0.313 | fixed |
| wolf | 0.000 | 0.600 | 0.850 | 0.347 × 0.600 | 0.600 | 0.850 | baseline: Adult |
| zoglin | 0.000 | 1.397 | 1.397 | 0.811 × 1.397 | 1.397 | 1.400 | baseline: Adult |
| zombie | 0.000 | 0.613 | 1.785 | 0.613 × 0.330 | 0.600 | 1.950 | baseline: Adult |
| zombie_horse | 0.000 | 1.396 | 1.600 | 1.195 × 1.396 | 1.397 | 1.600 | baseline: Adult |
| zombie_villager | 0.000 | 0.613 | 1.820 | 0.613 × 0.306 | 0.600 | 1.950 | baseline: Adult |
| zombified_piglin | 0.000 | 0.600 | 2.105 | 0.600 × 0.321 | 0.600 | 1.950 | baseline: Adult |

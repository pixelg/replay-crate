import type { PlayerItem } from '@replay-crate/api-client'

/** ~64px art for lists and the mini player. */
export const thumbOf = (item: PlayerItem) => (item.type === 'track' ? item.album.thumbUrl : item.thumbUrl)
/** ~300px art for the player page. */
export const imageOf = (item: PlayerItem) => (item.type === 'track' ? item.album.imageUrl : item.imageUrl)
/** The artists of a track, or the show an episode is from. */
export const subtitleOf = (item: PlayerItem) =>
  item.type === 'track' ? item.artists.map((artist) => artist.name).join(', ') : item.show.name

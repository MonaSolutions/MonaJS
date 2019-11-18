import { BinaryReader } from "../Base/BinaryReader.js";
import { BinaryWriter } from "../Base/BinaryWriter.js";
import { BitReader } from "../Base/BitReader.js";
import { Media } from "./Media.js";
import { MPEG4 } from "./MPEG4.js";

export let AVC = {
	Frames: [
		Media.Video.Frame.UNSPECIFIED, 
		Media.Video.Frame.INTER, 
		Media.Video.Frame.INTER, 
		Media.Video.Frame.INTER, 
		Media.Video.Frame.INTER, 
		Media.Video.Frame.KEY, 
		Media.Video.Frame.INFO, 
		Media.Video.Frame.CONFIG, // SPS
		Media.Video.Frame.CONFIG // PPS
	],

	NAL: {
		UNDEFINED: 0,
		SLICE_NIDR: 1,
		SLICE_A: 2,
		SLICE_B: 3,
		SLICE_C: 4,
		SLICE_IDR: 5,
		SEI: 6,
		SPS: 7,
		PPS: 8,
		AUD: 9,
		END_SEQ: 10,
		END_STREAM: 11,
		FILLER: 12,
	},
	
	NalType(byte) { return byte & 0x1F; },

	UpdateFrame(type, frame) {
		if (frame == Media.Video.Frame.KEY || frame == Media.Video.Frame.CONFIG)
			return frame;
		
		type = type > 8 ? Media.Video.Frame.UNSPECIFIED : this.Frames[type];
		if (frame==0)
			return type; // change
		switch (type) {
			case Media.Video.Frame.UNSPECIFIED:
				return frame; // unchange
			case Media.Video.Frame.KEY:
			case Media.Video.Frame.CONFIG:
			case Media.Video.Frame.INTER:
				return type; // change
			default:; // inter, disposable, info (old frame) => disposable, info (new frame)
		}
		return (frame == Media.Video.Frame.INTER || frame == Media.Video.Frame.DISPOSABLE_INTER) ? frame : type;
	},

	ParseVideoConfig(data) {
		var reader = new BinaryReader(data);
		var length;
		var results = [null,null];
		while (reader.available()) {
			length = reader.read32();
			if (length > reader.available())
				length = reader.available();
			if (!length)
				continue;
			var id = reader.current() & 0x1F;
			if (id == 7)
				results[0] = data.subarray(reader.position(), reader.position()+length);
			else if (id == 8)
				results[1] = data.subarray(reader.position(), reader.position()+length);
			reader.next(length);
		}
		if (results[0])
			return results; // pps not mandatory
		console.warn("H264 configuration malformed");
		return false;
	},

	ReadVideoConfig(data, writer) {

		let reader = new BinaryReader(data);
		reader.next(5); // skip avcC version 1 + 3 bytes of profile, compatibility, level + 1 byte xFF

		// SPS and PPS
		let count = reader.read8() & 0x1F;
		let isPPS = false;
		while (reader.available() >= 2 && count--) {
			let size = reader.read16();
			if (size > reader.available())
				size = reader.available();
			writer.write32(size).write(new Uint8Array(data.buffer, reader.position()+data.byteOffset, size));
			reader.next(size);
			if (!count) {
				if (isPPS)
					break;
				count = reader.read8(); // PPS now!
				isPPS = true;
			}
		}
		return reader.position();
	},

	WriteVideoConfig(writer, sps, pps) {
		// SPS + PPS
		writer.write8(0x01); // avcC version 1
		writer.write(sps.subarray(1, 4)); // profile, compatibility, level

		writer.write8(0xff); // 111111 + 2 bit NAL size - 1
							// sps
		writer.write8(0xe1); // 11 + number of SPS
		writer.write16(sps.length);
		writer.write(sps);

		// pps
		writer.write8(0x01); // number of PPS
		if(pps) {
			writer.write16(pps.length);
			writer.write(pps);
		} else
			writer.write16(0);
		return writer;
	},

	SPSToVideoDimension(data) {

		var reader = new BitReader(data);
		if ((reader.read8() & 0x1f) != 7) {
			console.error("Invalid SPS data");
			return 0;
		}

		var leftOffset = 0, rightOffset = 0, topOffset = 0, bottomOffset = 0;
		var subWidthC = 0, subHeightC = 0;

		var idc = reader.read8();
		reader.next(16); // constraincts
		MPEG4.ReadExpGolomb(reader); // seq_parameter_set_id

		switch (idc) {
			case 100:
			case 110:
			case 122:
			case 144:
			case 44:
			case 83:
			case 86:
			case 118:
				switch (MPEG4.ReadExpGolomb(reader)) { // chroma_format_idc
					case 1: // 4:2:0
						subWidthC = subHeightC = 2;
						break;
					case 2: // 4:2:2
						subWidthC = 2;
						subHeightC = 1;
						break;
					case 3: // 4:4:4
						if(!reader.read())
							subWidthC = subHeightC = 1; // separate_colour_plane_flag 
						break;
				}

				MPEG4.ReadExpGolomb(reader); // bit_depth_luma_minus8
				MPEG4.ReadExpGolomb(reader); // bit_depth_chroma_minus8
				reader.next(); // qpprime_y_zero_transform_bypass_flag
				if (reader.read()) { // seq_scaling_matrix_present_flag
					for (var i = 0; i < 8; ++i) {
						if (reader.read()) { // seq_scaling_list_present_flag
							var sizeOfScalingList = (i < 6) ? 16 : 64;
							var scale = 8;
							for (var j = 0; j < sizeOfScalingList; ++j) {
								var delta = MPEG4.ReadExpGolomb(reader);
								if (delta & 1)
									delta = (delta + 1) / 2;
								else
									delta = -(delta / 2);
								scale = (scale + delta + 256) % 256;
								if (!scale)
									break;
							}
						}
					}
				}
				break;
		}

		MPEG4.ReadExpGolomb(reader); // log2_max_frame_num_minus4
		var picOrderCntType = MPEG4.ReadExpGolomb(reader);
		if (!picOrderCntType) {
			MPEG4.ReadExpGolomb(reader); // log2_max_pic_order_cnt_lsb_minus4
		} else if (picOrderCntType == 1) {
			reader.next(); // delta_pic_order_always_zero_flag
			MPEG4.ReadExpGolomb(reader); // offset_for_non_ref_pic
			MPEG4.ReadExpGolomb(reader); // offset_for_top_to_bottom_field
			var refFrames = MPEG4.ReadExpGolomb(reader);
			for (var i = 0; i < refFrames; ++i)
				MPEG4.ReadExpGolomb(reader); // sps->offset_for_ref_frame[ i ] = ReadSE();
		}
		MPEG4.ReadExpGolomb(reader); // max_num_ref_frames
		reader.next(); // gaps_in_frame_num_value_allowed_flag
		var picWidth = (MPEG4.ReadExpGolomb(reader) + 1) * 16;
		var picHeight = (MPEG4.ReadExpGolomb(reader) + 1) * 16;
		if (!reader.read()) { // frame_mbs_only_flag
			picHeight *= 2;
			subHeightC *= 2;
			reader.next(); // mb_adaptive_frame_field_flag
		}

		reader.next(); // direct_8x8_inference_flag
		if (reader.read()) { // frame_cropping_flag
			leftOffset = MPEG4.ReadExpGolomb(reader);
			rightOffset = MPEG4.ReadExpGolomb(reader);
			topOffset = MPEG4.ReadExpGolomb(reader);
			bottomOffset = MPEG4.ReadExpGolomb(reader);
		}
		
		// return width << 16 | height;
		return ((picWidth - subWidthC * (leftOffset + rightOffset)) << 16) | (picHeight - subHeightC * (topOffset + bottomOffset));
	}
};

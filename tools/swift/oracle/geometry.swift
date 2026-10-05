// `oracle geometry <cases.json>`: runs ImageMarkupKit's geometry on the cases written by
// tools/swift/make-geometry-goldens.mjs and prints the results as JSON.
import CoreGraphics
import Foundation

private func elements(_ path: CGPath) -> [[Any]] {
    var result: [[Any]] = []
    path.applyWithBlock { element in
        let p = element.pointee.points
        switch element.pointee.type {
        case .moveToPoint: result.append(["M", p[0].x, p[0].y])
        case .addLineToPoint: result.append(["L", p[0].x, p[0].y])
        case .addQuadCurveToPoint: result.append(["Q", p[0].x, p[0].y, p[1].x, p[1].y])
        case .addCurveToPoint: result.append(["C", p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y])
        case .closeSubpath: result.append(["Z"])
        @unknown default: break
        }
    }
    return result
}

private func rectValue(_ rect: CGRect) -> Any {
    rect.isNull ? NSNull() : [rect.origin.x, rect.origin.y, rect.size.width, rect.size.height]
}

private func number(_ value: Any?) -> CGFloat { CGFloat((value as! NSNumber).doubleValue) }
private func point(_ value: Any?) -> CGPoint { let a = value as! [Any]; return CGPoint(x: number(a[0]), y: number(a[1])) }
private func pointValue(_ p: CGPoint) -> [CGFloat] { [p.x, p.y] }
private func boxValue(_ box: Box) -> [String: Any] { ["frame": rectValue(box.frame), "rotation": box.rotation] }
private func box(_ value: Any?) -> Box {
    let object = value as! [String: Any]
    let frame = object["frame"] as! [Any]
    return Box(frame: CGRect(x: number(frame[0]), y: number(frame[1]), width: number(frame[2]), height: number(frame[3])),
               rotation: number(object["rotation"]))
}

func runGeometry(_ url: URL) throws -> Data {
    let input = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    var output: [String: Any] = [:]

    output["shapes"] = (input["shapes"] as? [[String: Any]] ?? []).map { shape -> [String: Any] in
        let path = PathFactory.shapePath(kind: ShapeKind(rawValue: shape["kind"] as! String)!,
                                         size: CGSize(width: number(shape["width"]), height: number(shape["height"])),
                                         cornerRadius: number(shape["cornerRadius"]))
        return ["elements": elements(path), "bounds": rectValue(path.boundingBoxOfPath)]
    }

    output["strokes"] = (input["strokes"] as? [[Any]] ?? []).map { points -> [String: Any] in
        let path = PathFactory.smoothedPath(points.map(point))
        return ["elements": elements(path), "bounds": rectValue(path.boundingBoxOfPath)]
    }

    output["lines"] = (input["lines"] as? [[String: Any]] ?? []).map { line -> [String: Any] in
        let geometry = PathFactory.lineGeometry(samples: (line["samples"] as! [Any]).map(point), closed: line["closed"] as! Bool,
                                                lineWidth: number(line["lineWidth"]),
                                                startHead: ArrowHead(rawValue: line["startHead"] as! String)!,
                                                endHead: ArrowHead(rawValue: line["endHead"] as! String)!)
        return ["shaft": elements(geometry.shaft), "heads": geometry.heads.map(elements) ?? NSNull(),
                "shaftBounds": rectValue(geometry.shaft.boundingBoxOfPath)]
    }

    output["flatten"] = (input["flatten"] as? [[String: Any]] ?? []).map { entry -> [String: Any] in
        let points = (entry["points"] as! [Any]).map(point)
        let kind = LineKind(rawValue: entry["kind"] as! String)!
        let closed = entry["closed"] as! Bool
        let samples = LinePath.flattened(points, kind: kind, closed: closed)
        return ["samples": samples.map(pointValue),
                "insertion": LinePath.insertionPoints(points, kind: kind, closed: closed).map(pointValue),
                "trimmed": LinePath.trimmed(samples, head: 7.5, tail: 12.25).map(pointValue)]
    }

    output["resize"] = (input["resize"] as? [[String: Any]] ?? []).map { entry -> [[String: Any]] in
        let session = ResizeSession(box: box(entry["box"]), u: number(entry["u"]), v: number(entry["v"]), touch: point(entry["touch"]),
                                    lockAspect: entry["lockAspect"] as! Bool, minimumSize: number(entry["minimumSize"]),
                                    anchorsTop: entry["anchorsTop"] as! Bool)
        return (entry["drags"] as! [Any]).map { boxValue(session.box(for: point($0))) }
    }

    output["rotate"] = (input["rotate"] as? [[String: Any]] ?? []).map { entry -> [[String: Any]] in
        let session = RotateSession(box: box(entry["box"]), touch: point(entry["touch"]))
        return (entry["drags"] as! [Any]).map { boxValue(session.box(for: point($0))) }
    }

    output["boards"] = (input["boards"] as? [[String: Any]] ?? []).map { entry -> [Any] in
        let sizes = (entry["sizes"] as! [Any]).map { value -> ImageSource in
            let size = point(value)
            return ImageSource(assetID: "x", pixelSize: CGSize(width: size.x, height: size.y))
        }
        var board = MarkupDocument.board(sizes)
        if let more = entry["append"] as? [Any] {
            board.appendImages(more.map { value in
                let size = point(value)
                return ImageSource(assetID: "y", pixelSize: CGSize(width: size.x, height: size.y))
            })
        }
        return board.imageItems.map { rectValue($0.box!.frame) }
    }

    let hitPoints = (input["hitPoints"] as? [Any] ?? []).map(point)
    let bindPoints = (input["bindPoints"] as? [Any] ?? []).map(point)
    let tolerances = (input["tolerances"] as? [Any] ?? []).map(number)
    let segments = input["eraserSegments"] as? [[String: Any]] ?? []
    let exportOptions = input["exportOptions"] as? [[String: Any]] ?? []
    output["documents"] = try (input["documents"] as? [Any] ?? []).map { value -> [String: Any] in
        let document = try MarkupDocument.decode(from: JSONSerialization.data(withJSONObject: value))
        var result: [String: Any] = [:]
        result["bounds"] = document.items.map { rectValue(ItemGeometry.visualBounds(of: $0, in: document)) }
        result["samples"] = document.items.map { item -> Any in
            item.lineContent.map { LinePath.samples(of: $0, in: document).map(pointValue) } ?? NSNull()
        }
        result["hits"] = tolerances.map { tolerance in
            hitPoints.map { HitTesting.item(at: $0, in: document, tolerance: tolerance)?.id.uuidString ?? NSNull() as Any }
        }
        result["bindTargets"] = bindPoints.map { HitTesting.bindTarget(at: $0, in: document, tolerance: 5)?.id.uuidString ?? NSNull() as Any }
        result["bindings"] = document.items.map { item -> Any in
            bindPoints.map { p -> Any in
                Bindings.binding(for: p, on: item, snapDistance: 12).map { ["itemID": $0.itemID.uuidString, "anchor": pointValue($0.anchor)] } ?? NSNull()
            }
        }
        result["erase"] = segments.map { segment in
            HitTesting.erasableItems(alongSegment: point(segment["a"]), point(segment["b"]), radius: number(segment["r"]), in: document).map(\.uuidString)
        }
        result["plans"] = exportOptions.map { values -> [String: Any] in
            var options = MarkupExportOptions()
            if let v = values["maxPixelDimension"] { options.maxPixelDimension = number(v) }
            if let v = values["maxPixelCount"] { options.maxPixelCount = number(v) }
            if let v = values["boardPadding"] { options.boardPadding = number(v) }
            if let v = values["minimumBoardScale"] { options.minimumBoardScale = number(v) }
            let plan = ExportPlanner.plan(for: document, options: options)
            return ["rect": rectValue(plan.rect), "pixelSize": [plan.pixelSize.width, plan.pixelSize.height], "isClamped": plan.isClamped]
        }
        result["parents"] = document.items.map { Attachments.parent(for: $0, in: document)?.uuidString ?? NSNull() as Any }
        return result
    }

    output["carry"] = try (input["carry"] as? [[String: Any]] ?? []).map { entry -> String in
        let document = try MarkupDocument.decode(from: JSONSerialization.data(withJSONObject: entry["document"]!))
        let old = document.items[entry["item"] as! Int]
        var updated = old
        updated.box = box(entry["box"])
        var moved = document
        moved.update(old.id) { $0 = updated }
        Attachments.carryChildren(of: old, to: updated, from: document, into: &moved)
        return String(data: try moved.jsonData(), encoding: .utf8)!
    }

    return try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
}

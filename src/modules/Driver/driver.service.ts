import { Request, Response } from "express"
import {
  ConflictException,
  NotFoundException,
} from "../../Utils/response/error.response"
import { IRegisterDriverDTO, IRegisterDriverFilesDTO } from "./driver.dto"
import { DriverModel } from "../../DB/models/driver.model"
import { UserModel } from "../../DB/models/user.model"
import { RoleEnum } from "../../Utils/enums/user.enum"

class DriverService {
  register = async (req: Request, res: Response): Promise<Response> => {
    const {
      licenseNumber,
      brand,
      model,
      year,
      color,
      plateNumber,
    }: IRegisterDriverDTO = req.body
    const {
      licenseImage: [licenseImage],
      nationalIdImage: [nationalIdImage],
    } = req.files as unknown as IRegisterDriverFilesDTO
    const userId = req.user!._id
    if (req.user!.role === RoleEnum.DRIVER)
      throw new ConflictException("you are already a driver")
    const vehicle = {
      brand: brand,
      model: model,
      year: year,
      color: color,
      plateNumber: plateNumber,
    }
    const toRelativePath = (file: { filename: string }, folder: string) =>
      `uploads/${folder}/${file.filename}`
    const driver = await DriverModel.create({
      userId,
      licenseNumber,
      licenseImage: toRelativePath(licenseImage, "drivers"),
      nationalIdImage: toRelativePath(nationalIdImage, "drivers"),
      vehicle,
    })

    await UserModel.findByIdAndUpdate(userId, {
      role: RoleEnum.DRIVER,
    })

    return res
      .status(201)
      .json({ message: "Driver Registered Successfully", data: { driver } })
  }

  me = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!._id
    const driver = await DriverModel.findOne({ userId }).lean()
    if (!driver) throw new NotFoundException("Driver Data Not Found")
    return res
      .status(200)
      .json({ message: "driver retrieved successfully", driver })
  }

  isAvailable = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!._id
    const driver = await DriverModel.findOne({ userId }).lean()
    if (!driver) throw new NotFoundException("Driver Data Not Found")
    const status = !driver.isOnline
      ? "offline"
      : driver.isAvailable
        ? "available"
        : "on_trip"
    return res.status(200).json({ status })
  }
}

export default new DriverService()

// Resets the Postman test accounts so the collection can run end to end over plain HTTP.
// Run before every collection run:  node postman/seed.js
//
// - rider     (RIDER): requests, cancels and views rides
// - driver    (DRIVER): accepts, arrives, starts, completes and cancels rides
// - candidate (RIDER): registers as a driver during the run, so it's reset to a rider here
//
// Only these accounts (and users created by the signup test) are touched.

const { join } = require("node:path")
const { rm } = require("node:fs/promises")
const { config } = require("dotenv")
const mongoose = require("mongoose")
const { createClient } = require("redis")
const { hash } = require("bcrypt")

config({ path: join(__dirname, "..", "config", "dev.env"), quiet: true })

// Must match the collection variables of the same names.
const PASSWORD = process.env.POSTMAN_PASSWORD || "Postman@12345"
const PICKUP = {
  lng: Number(process.env.PICKUP_LNG || 31.2357),
  lat: Number(process.env.PICKUP_LAT || 30.0444),
}
const ACCOUNTS = {
  rider: { email: "postman.rider@idrive.test", firstname: "Postman", lastname: "Rider", role: "RIDER" },
  driver: { email: "postman.driver@idrive.test", firstname: "Postman", lastname: "Driver", role: "DRIVER" },
  candidate: { email: "postman.candidate@idrive.test", firstname: "Postman", lastname: "Candidate", role: "RIDER" },
}
const SIGNUP_EMAILS = /^postman\.signup\..*@idrive\.test$/

// The socket normally keeps this fresh (120 s TTL); an hour leaves time to run the collection.
const DRIVER_LOCATION_TTL_SECONDS = 60 * 60

const main = async () => {
  await mongoose.connect(process.env.DB_URI, { serverSelectionTimeoutMS: 5000 })
  const redis = createClient({ url: process.env.REDIS_URL, RESP: 2 })
  await redis.connect()

  try {
    const db = mongoose.connection.db
    const users = db.collection("users")
    const drivers = db.collection("drivers")
    const rides = db.collection("rides")
    const password = await hash(PASSWORD, Number(process.env.SALT) || 12)
    const now = new Date()

    const ids = {}
    for (const [key, account] of Object.entries(ACCOUNTS)) {
      await users.updateOne(
        { email: account.email },
        {
          $set: {
            ...account,
            username: `postman_${key}`,
            phone: "01000000000",
            password,
            confirmedAt: now,
            provider: "SYSTEM",
            gender: "MALE",
            savedPlaces: [],
            updatedAt: now,
          },
          $unset: { changeCredentialsTime: "" },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      )
      ids[key] = (await users.findOne({ email: account.email }, { projection: { _id: 1 } }))._id
    }

    // Driver: offline (login refuses online drivers) but available, so it can accept rides.
    await drivers.updateOne(
      { userId: ids.driver },
      {
        $set: {
          licenseNumber: "POSTMAN-LIC-001",
          licenseImage: "uploads/drivers/postman-fixture.png",
          nationalIdImage: "uploads/drivers/postman-fixture.png",
          vehicle: { brand: "Toyota", model: "Corolla", year: 2022, color: "White", plateNumber: "PM1001" },
          isOnline: false,
          isAvailable: true,
          updatedAt: now,
        },
        $setOnInsert: { earningsBalance: 0, createdAt: now },
      },
      { upsert: true },
    )

    // Candidate: drop the driver profile (and its uploaded images) from the previous run.
    const candidateDriver = await drivers.findOne({ userId: ids.candidate })
    if (candidateDriver) {
      for (const file of [candidateDriver.licenseImage, candidateDriver.nationalIdImage])
        if (file) await rm(join(__dirname, "..", file), { force: true })
      await drivers.deleteOne({ _id: candidateDriver._id })
    }

    // Users created by the signup test.
    const signupUsers = await users.deleteMany({ email: SIGNUP_EMAILS })

    // Rides from previous runs, so "active ride" checks start clean.
    const testIds = Object.values(ids)
    const deletedRides = await rides.deleteMany({
      $or: [{ riderId: { $in: testIds } }, { driverId: { $in: testIds } }],
    })

    // Redis: no cached estimate (the "call estimate first" test relies on it), no active ride,
    // and a driver position on the pickup point so manual arrival is allowed.
    await redis.del([
      ...testIds.map((id) => `estimate:${id}`),
      `driver:activeRide:${ids.driver}`,
    ])
    await redis.zRem("online:users", ids.driver.toString())
    await redis.set(
      `driver:lastLocation:${ids.driver}`,
      JSON.stringify({ ...PICKUP, updatedAt: now.toISOString() }),
      { EX: DRIVER_LOCATION_TTL_SECONDS },
    )

    console.log("Postman test data ready")
    for (const [key, account] of Object.entries(ACCOUNTS))
      console.log(`  ${key.padEnd(9)} ${account.email}  (${ids[key]})`)
    console.log(`  password  ${PASSWORD}`)
    console.log(`  removed   ${deletedRides.deletedCount} ride(s), ${signupUsers.deletedCount} signup user(s)`)
  } finally {
    await redis.quit()
    await mongoose.disconnect()
  }
}

main().catch((error) => {
  console.error("Seeding failed:", error.message)
  process.exit(1)
})
